const tools=['sp_create_project','sp_open_project','sp_get_document','sp_get_slide','sp_edit','sp_render_slide','sp_validate','sp_save_export','sp_list_projects','sp_project_info','sp_list_slides','sp_list_themes','sp_get_theme','sp_preview_theme','sp_apply_theme','sp_save_theme','sp_list_revisions','sp_get_revision','sp_revision_diff','sp_restore_revision'];
const bytes=value=>Number.isFinite(value)?(value/1048576).toFixed(1)+' MiB':'不可用';
const time=value=>new Date(value).toLocaleString('zh-CN');
const localDate=value=>new Date(value.getTime()-value.getTimezoneOffset()*60000).toISOString().slice(0,16);
export function mountObservability({container,api}){
 const document=container.ownerDocument,view=document.defaultView;let offset=0,destroyed=false,generation=0,total=0;const limit=25;
 const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);return el;};
 const form=node('form');form.className='admin-toolbar';
 function field(name,label,type,value){const wrap=node('label',label),input=node('input');input.name=name;input.type=type;input.value=value??'';wrap.append(input);form.append(wrap);return input;}
 const from=field('from','开始时间','datetime-local',localDate(new Date(Date.now()-86400000))),to=field('to','结束时间','datetime-local',localDate(new Date()));from.required=to.required=true;
 const user=field('userId','用户 ID','text');user.placeholder='全部用户';user.pattern='[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}';
 const toolWrap=node('label','工具'),tool=node('select');tool.name='tool';for(const name of ['',...tools]){const option=node('option',name||'全部工具');option.value=name;tool.append(option);}toolWrap.append(tool);form.append(toolWrap);
 const submit=node('button','查询');submit.type='submit';form.append(submit);
 const status=node('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const resources=node('section'),calls=node('section'),pages=node('div');pages.className='pagination';
 const previous=node('button','上一页'),next=node('button','下一页'),page=node('span');previous.type=next.type='button';pages.append(previous,page,next);
 container.replaceChildren(form,status,resources,calls,pages);
 function table(section,caption,headers,rows){section.append(node('h3',caption));const wrap=node('div');wrap.className='table-wrap';const table=node('table'),head=node('thead'),tr=node('tr');for(const title of headers){const th=node('th',title);th.scope='col';tr.append(th);}head.append(tr);table.append(head);const body=node('tbody');for(const values of rows){const row=node('tr');for(const value of values)row.append(node('td',value??'—'));body.append(row);}table.append(body);wrap.append(table);section.append(wrap);}
 function renderResources(data){
  resources.replaceChildren(node('h2','资源状态'));
  resources.append(node('p','采集时间：'+time(data.generatedAt)));
  const app=data.application,host=data.host;
  table(resources,'应用进程、容器与数据库',['指标范围','状态','实际数据'],[
   ['应用进程',app.status,`RSS ${bytes(app.memory.rssBytes)}；堆 ${bytes(app.memory.heapUsedBytes)}；CPU 单核占比 ${app.cpu.oneCorePercent===null?'采集中':app.cpu.oneCorePercent.toFixed(1)+'%'}；运行 ${Math.floor(app.uptimeSeconds)} 秒`],
   ['可见 cgroup 资源',app.cgroup.status,app.cgroup.status==='ok'?`内存 ${bytes(app.cgroup.memoryBytes)} / ${bytes(app.cgroup.memoryLimitBytes)}；累计 CPU ${app.cgroup.cpuUsageMs.toFixed(1)} ms`:app.cgroup.reason],
   ['应用文件系统',app.disk.status,app.disk.status==='ok'?`可用 ${bytes(app.disk.availableBytes)} / ${bytes(app.disk.totalBytes)}`:'不可用'],
   ['当前 API 请求',data.api.status,'此请求已响应，不代表其他接口全部正常'],
   ['当前数据库',data.database.status,`连接 ${data.database.connections}，活跃 ${data.database.active}；探测 ${data.database.probeDurationMs.toFixed(1)} ms`],
  ]);
  table(resources,'Hakari 整机',['状态','采集时间','CPU','内存','磁盘'],[[host.status==='ok'?'正常':'不可用',host.status==='ok'?time(host.generatedAt):host.reason,host.status==='ok'?host.cpu.percent.toFixed(1)+'%':'—',host.status==='ok'?`可用 ${bytes(host.memory.availableBytes)} / ${bytes(host.memory.totalBytes)}`:'—',host.status==='ok'?`可用 ${bytes(host.disk.availableBytes)} / ${bytes(host.disk.totalBytes)}`:'—']]);
  if(host.status==='ok'){
   const containers=host.containers;
   if(containers.rows?.length){resources.append(node('p','容器来源：Hakari 固定 Docker inspect 采集 · '+time(containers.generatedAt)));table(resources,'Superior Point 指定容器',['容器','采集状态','运行状态','健康检查','重启次数','OOM'],containers.rows.map(row=>[row.name,row.status==='ok'?'可读取':row.reason,row.state,row.health,row.restartCount,row.oomKilled===undefined?'—':row.oomKilled?'是':'否']));}
   else resources.append(node('p','整机容器状态：'+containers.reason));
  }
 }
 async function refresh(){
  if(destroyed)return;const current=++generation;status.textContent='正在读取实际统计…';
  try{
   const fromDate=new Date(from.value),toDate=new Date(to.value);if(!Number.isFinite(fromDate.getTime())||!Number.isFinite(toDate.getTime())||fromDate>=toDate)throw Error('请选择有效的开始和结束时间。');
   const query=new URLSearchParams({from:fromDate.toISOString(),to:toDate.toISOString(),limit:String(limit),offset:String(offset)});if(user.value.trim())query.set('userId',user.value.trim());if(tool.value)query.set('tool',tool.value);
   const [stats,data]=await Promise.all([api.request('/admin/observability/tools?'+query),api.request('/admin/observability/resources')]);
   if(destroyed||current!==generation)return;
   total=stats.total;calls.replaceChildren(node('h2','Agent 工具调用'));
   calls.append(node('p',`${stats.summary.calls} 条已记录调用；${stats.summary.errors} 次失败；错误率 ${(stats.summary.errorRate*100).toFixed(1)}%；平均 ${stats.summary.averageDurationMs.toFixed(1)} ms`));
   table(calls,'调用记录',['时间','用户','工具','传输','结果','耗时','错误代码'],stats.rows.map(row=>[time(row.createdAt),row.userId||'已删除用户',row.tool,row.transport,row.outcome==='success'?'成功':'失败',row.durationMs.toFixed(1)+' ms',row.errorCode]));
   if(!stats.rows.length)calls.append(node('p','此时间范围暂无调用记录。'));
   renderResources(data);previous.disabled=offset===0;next.disabled=offset+limit>=total;page.textContent=`第 ${Math.floor(offset/limit)+1} 页，共 ${total} 条`;status.textContent='数据已更新。';
  }catch(error){if(!destroyed&&current===generation)status.textContent=error.message||'统计暂不可用，请重试。';}
 }
 form.onsubmit=event=>{event.preventDefault();if(!form.reportValidity())return;offset=0;refresh();};
 previous.onclick=()=>{offset=Math.max(0,offset-limit);refresh();};next.onclick=()=>{if(offset+limit<total){offset+=limit;refresh();}};
 const interval=view.setInterval(refresh,30000);refresh();
 return {refresh,destroy(){destroyed=true;generation++;view.clearInterval(interval);form.onsubmit=previous.onclick=next.onclick=null;}};
}
