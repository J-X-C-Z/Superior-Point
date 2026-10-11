import {open,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {statfs} from 'node:fs/promises';
import {errors,transaction,type Actor,type Database} from '../contracts.js';
import {checkAdminActor,pagination} from '../services/admin-service.js';
export const mcpTools=['sp_create_project','sp_open_project','sp_get_document','sp_get_slide','sp_edit','sp_render_slide','sp_validate','sp_save_export','sp_list_projects','sp_project_info','sp_list_slides','sp_list_themes','sp_get_theme','sp_preview_theme','sp_apply_theme','sp_save_theme'] as const;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
type Call={actor:Actor;tool:string;durationMs:number;outcome:'success'|'error';errorCode?:string;transport:'streamable-http'|'stdio-bridge'};
type Filter={from?:string;to?:string;userId?:string;tool?:string;limit?:number;offset?:number};
export class MetricsService {
 private activeWrites=0;
 private previousCpu={usage:process.cpuUsage(),time:performance.now()};
 constructor(private readonly db:Database,private readonly options:{hostMetricsFile?:string}={}){}
 async recordToolCall(input:Call):Promise<boolean>{
  let admitted=false;
  try {
   if(input.actor.source!=='mcp'||!uuid.test(input.actor.id)||!input.actor.tokenId||!uuid.test(input.actor.tokenId)||!mcpTools.includes(input.tool as typeof mcpTools[number])||!finite(input.durationMs)||input.durationMs>86400000||!['success','error'].includes(input.outcome)||!['streamable-http','stdio-bridge'].includes(input.transport))return false;
   if(this.activeWrites>=2)return false;this.activeWrites++;admitted=true;
   const errorCode=input.errorCode&&/^[A-Z][A-Z0-9_]{0,63}$/.test(input.errorCode)?input.errorCode:null;
   await transaction(this.db,async client=>{
    await client.query("SET LOCAL statement_timeout='250ms'; SET LOCAL lock_timeout='100ms'");
    await client.query('INSERT INTO mcp_tool_metrics(actor_id,tool,duration_ms,outcome,error_code,transport) VALUES($1,$2,$3,$4,$5,$6)',[input.actor.id,input.tool,input.durationMs,input.outcome,errorCode,input.transport]);
   });return true;
  }catch{return false;}finally{if(admitted)this.activeWrites--;}
 }
 async tools(actor:Actor,filter:Filter={}){
  const {limit,offset}=pagination(filter),to=filter.to?new Date(filter.to):new Date(),from=filter.from?new Date(filter.from):new Date(to.getTime()-24*60*60*1000);
  if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||from>=to||to.getTime()-from.getTime()>366*86400000||filter.userId&&!uuid.test(filter.userId)||filter.tool&&!mcpTools.includes(filter.tool as typeof mcpTools[number]))throw errors.invalid('调用统计筛选参数无效');
  return transaction(this.db,async client=>{
   await checkAdminActor(client,actor);
   const values=[from.toISOString(),to.toISOString(),filter.userId??null,filter.tool??null];
   const where='created_at >= $1 AND created_at < $2 AND ($3::uuid IS NULL OR actor_id=$3) AND ($4::text IS NULL OR tool=$4)';
   const totals=(await client.query(`SELECT count(*)::int AS calls,count(*) FILTER(WHERE outcome='error')::int AS errors,COALESCE(avg(duration_ms),0)::float8 AS "averageDurationMs" FROM mcp_tool_metrics WHERE ${where}`,values)).rows[0];
   const rows=(await client.query(`SELECT id::text,actor_id AS "userId",tool,duration_ms AS "durationMs",outcome,error_code AS "errorCode",transport,created_at AS "createdAt" FROM mcp_tool_metrics WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $5 OFFSET $6`,[...values,limit,offset])).rows;
   return {from:from.toISOString(),to:to.toISOString(),total:totals.calls,summary:{...totals,errorRate:totals.calls?totals.errors/totals.calls:0},rows,limit,offset};
  });
 }
 private async host(){
  if(!this.options.hostMetricsFile)return {status:'unavailable',reason:'未配置整机只读采集文件'};
  let file;try {
   file=await open(this.options.hostMetricsFile,constants.O_RDONLY|constants.O_NOFOLLOW);const info=await file.stat();if(!info.isFile()||info.size>65536)throw Error('Invalid metrics file');
   const buffer=Buffer.alloc(65537),{bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead>65536)throw Error('Metrics file too large');
   const data=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8')),age=Date.now()-new Date(data.generatedAt).getTime();
   if(data.source!=='hakari-host'||!Number.isFinite(age)||age< -5000||age>120000)return {status:'unavailable',reason:'整机采集文件已过期或无效'};
   if(!finite(data.cpu?.percent)||data.cpu.percent>100||!finite(data.memory?.totalBytes)||!finite(data.memory?.availableBytes)||data.memory.availableBytes>data.memory.totalBytes||!finite(data.disk?.totalBytes)||!finite(data.disk?.availableBytes)||data.disk.availableBytes>data.disk.totalBytes)throw Error('Invalid metrics values');
   return {status:'ok',source:'hakari-host',generatedAt:new Date(data.generatedAt).toISOString(),cpu:{percent:data.cpu.percent},memory:{totalBytes:data.memory.totalBytes,availableBytes:data.memory.availableBytes},disk:{totalBytes:data.disk.totalBytes,availableBytes:data.disk.availableBytes},containers:{status:'unavailable',reason:'未配置容器状态采集'}};
  }catch{return {status:'unavailable',reason:'整机采集文件不可读或无效'};}finally{await file?.close();}
 }
 async resources(actor:Actor){
  const database=await transaction(this.db,async client=>{
   await checkAdminActor(client,actor);const start=performance.now();
   const row=(await client.query("SELECT count(*)::int AS connections,count(*) FILTER(WHERE state='active')::int AS active FROM pg_stat_activity WHERE datname=current_database()" )).rows[0];
   return {status:'ok',...row,probeDurationMs:performance.now()-start};
  });
  const usage=process.cpuUsage(),now=performance.now(),elapsed=now-this.previousCpu.time;
  const cpu={totalCpuMs:(usage.user+usage.system)/1000,oneCorePercent:elapsed>0?((usage.user+usage.system-this.previousCpu.usage.user-this.previousCpu.usage.system)/1000)/elapsed*100:null};this.previousCpu={usage,time:now};
  const memory=process.memoryUsage();
  let cgroup:Record<string,unknown>={status:'unavailable',reason:'无可读的 cgroup v2 数据'};
  if(process.platform==='linux')try{const [current,max,cpuStat,cpuMax]=await Promise.all(['memory.current','memory.max','cpu.stat','cpu.max'].map(name=>readFile('/sys/fs/cgroup/'+name,'utf8')));const stat=Object.fromEntries(cpuStat.trim().split('\n').map(line=>line.split(/\s+/)));cgroup={status:'ok',scope:'visible-cgroup-mount',memoryBytes:Number(current.trim()),memoryLimitBytes:max.trim()==='max'?null:Number(max.trim()),cpuUsageMs:Number(stat.usage_usec)/1000,cpuQuota:cpuMax.trim()};}catch{}
  let disk:Record<string,unknown>={status:'unavailable'};try{const fs=await statfs(process.cwd());disk={status:'ok',scope:'application-filesystem',totalBytes:fs.blocks*fs.bsize,availableBytes:fs.bavail*fs.bsize};}catch{}
  return {generatedAt:new Date().toISOString(),application:{status:'ok',scope:'application-process',uptimeSeconds:process.uptime(),cpu,memory:{rssBytes:memory.rss,heapUsedBytes:memory.heapUsed,heapTotalBytes:memory.heapTotal},cgroup,disk},api:{status:'ok',scope:'this-resource-request'},database,host:await this.host()};
 }
}
