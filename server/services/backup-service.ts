import {mkdir,readFile,writeFile,readdir,lstat,copyFile,chmod,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import {transaction,ServiceError,type Actor,type Database} from '../contracts.js';
import {checkAdminActor} from './admin-service.js';
type Options={directory?:string;assetDirectory?:string;databaseUrl?:string;restoreDatabaseUrl?:string;pgBinDirectory?:string};
type Manifest={version:1;schema:string;databaseSha256:string;projects:{id:string;revision:number;sha256:string}[];assets:{file:string;sha256:string}[];restoredAt?:string};
const digest=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const stable=(value:any):string=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':JSON.stringify(value);
async function directory(target:string){await mkdir(target,{recursive:true,mode:0o700});if((await lstat(target)).isSymbolicLink())throw Error('Backup symlink refused');return realpath(target);}
async function assets(source:string,target:string):Promise<Manifest['assets']>{
 const result:Manifest['assets']=[];
 async function walk(relative='') {for(const name of await readdir(path.join(source,relative))){const file=path.join(relative,name),from=path.join(source,file),info=await lstat(from);if(info.isSymbolicLink())throw Error('Asset symlink refused');if(info.isDirectory()){await mkdir(path.join(target,file),{recursive:true,mode:0o700});await walk(file);}else if(info.isFile()){await copyFile(from,path.join(target,file));await chmod(path.join(target,file),0o600);result.push({file:file.split(path.sep).join('/'),sha256:digest(await readFile(path.join(target,file)))});}else throw Error('Unsupported asset file');}}
 await walk();return result.sort((a,b)=>a.file.localeCompare(b.file));
}
function pgEnvironment(raw:string){const url=new URL(raw);if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('Invalid database URL');return {...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGSSLMODE:url.searchParams.get('sslmode')||'prefer'};}
async function run(binary:string,args:string[],env:NodeJS.ProcessEnv){await new Promise<void>((resolve,reject)=>{const child=spawn(binary,args,{env,stdio:['ignore','ignore','ignore']});const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Backup command timed out'));},5*60*1000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Object.assign(Error('Backup command failed: '+path.basename(binary)),{code:path.basename(binary)+'_FAILED'}));});});}

/** Runs only fixed PostgreSQL programs; no request can supply commands, paths or restore database names. */
export class BackupService {
 private flight:Promise<void>|null=null;
 constructor(private db:Database,private options:Options={}){}
 private async flightLock(){
  const client=await this.db.connect();
  try{const result=await client.query("SELECT pg_try_advisory_lock(hashtext(current_schema()||':sp-backup-flight')) AS acquired");if(!result.rows[0].acquired){client.release();return null;}}
  catch(error){client.release();throw error;}
  return async()=>{try{await client.query("SELECT pg_advisory_unlock(hashtext(current_schema()||':sp-backup-flight'))");}finally{client.release();}};
 }
 async list(actor:Actor){return transaction(this.db,async client=>{await checkAdminActor(client,actor);const jobs=(await client.query('SELECT id,status,created_at AS "createdAt",completed_at AS "completedAt",error_code AS "errorCode" FROM backup_jobs ORDER BY created_at DESC LIMIT 100')).rows;return {configured:!!(this.options.directory&&this.options.databaseUrl),restoreConfigured:!!this.options.restoreDatabaseUrl,jobs};});}
 async start(actor:Actor){
  if(!this.options.directory||!this.options.databaseUrl)throw new ServiceError('BACKUP_UNAVAILABLE',503,'备份服务尚未配置');
  if(this.flight)throw new ServiceError('BACKUP_BUSY',409,'已有备份正在运行');
  const unlock=await this.flightLock();if(!unlock)throw new ServiceError('BACKUP_BUSY',409,'已有备份正在运行');
  const id=randomUUID();try{await transaction(this.db,async client=>{await checkAdminActor(client,actor,true);await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()||':sp-backup'))");if((await client.query("SELECT 1 FROM backup_jobs WHERE status IN ('queued','running') LIMIT 1")).rowCount)throw new ServiceError('BACKUP_BUSY',409,'已有备份正在运行');await client.query("INSERT INTO backup_jobs(id,status,initiator_id) VALUES($1,'queued',$2)",[id,actor.id]);await client.query("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,outcome) VALUES($1,'backup.start','backup',$2,'success')",[actor.id,id]);});}catch(error){await unlock();throw error;}
  this.flight=this.perform(id).catch(async(error)=>{await this.db.query("UPDATE backup_jobs SET status='failed',error_code=$2,completed_at=clock_timestamp() WHERE id=$1",[id,typeof error.code==='string'?error.code:'BACKUP_FAILED']);}).finally(async()=>{try{await unlock();}finally{this.flight=null;}});
  return {id,status:'queued'};
 }
 async waitForIdle(){await this.flight;}
 async reconcileInterrupted(){if(this.options.directory&&this.options.databaseUrl){const unlock=await this.flightLock();if(!unlock)return;try{await this.db.query("UPDATE backup_jobs SET status='failed',error_code='INTERRUPTED',completed_at=clock_timestamp() WHERE status IN ('queued','running')");}finally{await unlock();}}}
 async startScheduled(){
  if(!this.options.directory||!this.options.databaseUrl)throw Error('Backup configuration required');
  if(this.flight)throw Error('Backup already running');
  const unlock=await this.flightLock();if(!unlock)throw Error('Backup already running');
  const id=randomUUID();try{await transaction(this.db,async client=>{await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()||':sp-backup'))");if((await client.query("SELECT 1 FROM backup_jobs WHERE status IN ('queued','running') LIMIT 1")).rowCount)throw Error('Backup already running');await client.query("INSERT INTO backup_jobs(id,status,initiator_id) VALUES($1,'queued',NULL)",[id]);await client.query("INSERT INTO audit_logs(action,resource_type,resource_id,outcome) VALUES('backup.scheduled','backup',$1,'success')",[id]);});}catch(error){await unlock();throw error;}
  this.flight=this.perform(id).catch(async(error)=>{await this.db.query("UPDATE backup_jobs SET status='failed',error_code=$2,completed_at=clock_timestamp() WHERE id=$1",[id,typeof error.code==='string'?error.code:'BACKUP_FAILED']);}).finally(async()=>{try{await unlock();}finally{this.flight=null;}});
  return {id,status:'queued'};
 }
 private binary(name:string){return this.options.pgBinDirectory?path.join(this.options.pgBinDirectory,name):name;}
 private async perform(id:string){
  const root=await directory(this.options.directory!),job=await directory(path.join(root,id));const assetTarget=await directory(path.join(job,'assets'));
  await this.db.query("UPDATE backup_jobs SET status='running' WHERE id=$1",[id]);
  const client=await this.db.connect();let manifest:Manifest;
  try{
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const schema=(await client.query('SELECT current_schema() AS name')).rows[0].name as string;
   if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))throw Error('Unsupported backup schema');
   const snapshot=(await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
   const rows=(await client.query('SELECT id,revision,document_jsonb FROM projects ORDER BY id')).rows;
   await run(this.binary('pg_dump'),['--format=custom','--no-owner','--no-acl','--schema='+schema,'--snapshot='+snapshot,'--file='+path.join(job,'database.dump')],pgEnvironment(this.options.databaseUrl!));
   await chmod(path.join(job,'database.dump'),0o600);
   const savedAssets=this.options.assetDirectory?await assets(await directory(this.options.assetDirectory),assetTarget):[];
   manifest={version:1,schema,databaseSha256:digest(await readFile(path.join(job,'database.dump'))),projects:rows.map(row=>({id:row.id,revision:Number(row.revision),sha256:digest(stable(row.document_jsonb))})),assets:savedAssets};
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  if(this.options.restoreDatabaseUrl){await this.verify(job,manifest);manifest.restoredAt=new Date().toISOString();}
  await writeFile(path.join(job,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  await this.db.query("UPDATE backup_jobs SET status=$2,manifest_key=$3,completed_at=clock_timestamp() WHERE id=$1",[id,manifest.restoredAt?'verified':'completed',id]);
 }
 private async verify(job:string,manifest:Manifest){
  if(manifest.version!==1||!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(manifest.schema)||digest(await readFile(path.join(job,'database.dump')))!==manifest.databaseSha256)throw Error('Backup verification mismatch');
  for(const item of manifest.assets){if(item.file.split('/').some(p=>p==='..'||p==='.'||!p)||item.file.includes('\\')||path.isAbsolute(item.file))throw Error('Invalid asset path');const file=path.join(job,'assets',item.file);if((await lstat(file)).isSymbolicLink()||digest(await readFile(file))!==item.sha256)throw Error('Asset verification mismatch');}
  const name='sp_restore_'+randomUUID().replaceAll('-','');const base=new URL(this.options.restoreDatabaseUrl!);const control=new pg.Client({connectionString:base.toString()});let created=false;
  await control.connect();
  try{
   await control.query(`CREATE DATABASE "${name}"`);created=true;
   const restoreUrl=new URL(base);restoreUrl.pathname='/'+name;restoreUrl.searchParams.delete('options');
   if(manifest.schema==='public'){
    const scratch=new pg.Client({connectionString:restoreUrl.toString()});await scratch.connect();
    try{await scratch.query('DROP SCHEMA public');}finally{await scratch.end();}
   }
   await run(this.binary('pg_restore'),['--dbname='+name,'--no-owner','--no-acl','--exit-on-error','--single-transaction',path.join(job,'database.dump')],pgEnvironment(restoreUrl.toString()));
   const restored=new pg.Client({connectionString:restoreUrl.toString()});await restored.connect();
   try{const rows=(await restored.query(`SELECT id,revision,document_jsonb FROM "${manifest.schema}".projects ORDER BY id`)).rows;const values=rows.map(row=>({id:row.id,revision:Number(row.revision),sha256:digest(stable(row.document_jsonb))}));if(JSON.stringify(values)!==JSON.stringify(manifest.projects))throw Error('Restored documents differ');}finally{await restored.end();}
  }finally{if(created)await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);await control.end();}
 }
 async restoreChecks(actor:Actor){
  if(!this.options.directory||!this.options.restoreDatabaseUrl)throw new ServiceError('BACKUP_UNAVAILABLE',503,'隔离恢复服务尚未配置');
  if(this.flight)throw new ServiceError('BACKUP_BUSY',409,'请等待当前备份完成');
  const unlock=await this.flightLock();if(!unlock)throw new ServiceError('BACKUP_BUSY',409,'请等待当前备份完成');
  try {
  await transaction(this.db,async client=>{await checkAdminActor(client,actor,true);});
  const rows=(await this.db.query("SELECT id,manifest_key FROM backup_jobs WHERE status IN ('completed','verified') ORDER BY created_at DESC LIMIT 1")).rows;
  if(!rows.length)throw new ServiceError('NOT_FOUND',404,'没有可验证的备份');
  const key=rows[0].manifest_key;if(!/^[a-f0-9-]{36}$/.test(key))throw Error('Invalid backup key');
  const root=await directory(this.options.directory),job=path.join(root,key);if((await lstat(job)).isSymbolicLink())throw Error('Backup symlink refused');
  try {
   const manifest=JSON.parse(await readFile(path.join(job,'manifest.json'),'utf8')) as Manifest;await this.verify(job,manifest);
   manifest.restoredAt=new Date().toISOString();await writeFile(path.join(job,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
   await transaction(this.db,async client=>{await client.query("UPDATE backup_jobs SET status='verified',error_code=NULL WHERE id=$1",[rows[0].id]);await client.query("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,outcome) VALUES($1,'backup.restore_check','backup',$2,'success')",[actor.id,rows[0].id]);});
   return {id:rows[0].id,status:'verified',restoredAt:manifest.restoredAt,projectCount:manifest.projects.length,assetCount:manifest.assets.length};
  } catch(error) {
   await transaction(this.db,async client=>{await client.query("UPDATE backup_jobs SET status='failed',error_code='RESTORE_CHECK_FAILED' WHERE id=$1",[rows[0].id]);await client.query("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,outcome) VALUES($1,'backup.restore_check','backup',$2,'failure')",[actor.id,rows[0].id]);});
   throw error;
  }
  }finally{await unlock();}
 }
}
