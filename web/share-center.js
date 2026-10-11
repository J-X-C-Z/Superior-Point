import {formDialog} from './admin/app.js';
export async function openShareCenter({api,projectId,accountId,document=globalThis.document}){
 if(!accountId||api.user?.id!==accountId)throw Error('请登录项目所属账号。');
 const previous=document.activeElement,dialog=document.createElement('dialog'),title=document.createElement('h2'),note=document.createElement('p'),status=document.createElement('p'),list=document.createElement('div'),create=document.createElement('button'),close=document.createElement('button');
 title.textContent='分享链接';title.id='share-center-title';dialog.setAttribute('aria-labelledby',title.id);note.textContent='分享当前已保存版本。之后修改文稿不会更新此链接；持有链接的人可查看公开展示内容。备注、批注和历史不随链接分享。';status.setAttribute('role','status');create.type=close.type='button';create.textContent='创建 7 天有效链接';close.textContent='关闭';let busy=false;
 const finish=()=>{dialog.close?.();dialog.remove();previous?.focus?.();};close.onclick=finish;dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});dialog.append(title,note,status,create,list,close);document.body.append(dialog);dialog.showModal?.();
 const same=()=>dialog.isConnected&&api.user?.id===accountId;
 const path='/projects/'+encodeURIComponent(projectId)+'/shares';
 async function reload(){const rows=await api.request(path);if(!same())return;list.replaceChildren();if(!rows.length){const empty=document.createElement('p');empty.textContent='暂无分享链接。';list.append(empty);}
  for(const row of rows){const item=document.createElement('p'),label=document.createElement('span'),revoke=document.createElement('button');label.textContent=`修订 ${row.revision} · 到期 ${new Date(row.expiresAt).toLocaleString('zh-CN')} · ${row.revokedAt?'已撤销':Date.parse(row.expiresAt)<=Date.now()?'已到期':row.active===false?'暂不可用':'有效'} `;revoke.textContent='撤销';revoke.type='button';revoke.disabled=!!row.revokedAt;revoke.onclick=async()=>{if(busy||!same())return;busy=true;revoke.disabled=true;try{if(!await formDialog(document,'撤销分享链接',[],{message:'此链接将无法继续打开，已下载的内容无法收回。',confirm:'撤销链接'})||!same())return;await api.request(path+'/'+encodeURIComponent(row.id),{method:'DELETE'});if(same()){status.textContent='链接已撤销。';await reload();}}catch(error){if(same())status.textContent=error.message;}finally{busy=false;revoke.disabled=!!row.revokedAt;}};item.append(label,revoke);list.append(item);}
 }
 create.onclick=async()=>{if(busy||!same())return;busy=true;create.disabled=true;try{
  if(!await formDialog(document,'创建分享链接',[],{message:'将公开当前已保存的固定版本，链接有效期为 7 天。请确认展示内容可以分享。',confirm:'创建链接'})||!same())return;
  const current=await api.request('/projects/'+encodeURIComponent(projectId));if(!same())return;
  const result=await api.request(path,{method:'POST',body:{expectedRevision:current.revision,expiresAt:new Date(Date.now()+7*86400000).toISOString()}});if(!same())return;
  const secret=document.createElement('textarea'),done=document.createElement('button'),copy=document.createElement('button'),box=document.createElement('div');secret.value=result.url;secret.readOnly=true;secret.rows=3;secret.setAttribute('aria-label','新建分享链接（仅显示一次）');done.type=copy.type='button';done.textContent='关闭链接显示';copy.textContent='复制链接';copy.onclick=async()=>{try{await document.defaultView.navigator.clipboard.writeText(secret.value);copy.textContent='已复制';}catch{secret.focus();secret.select();}};done.onclick=()=>{secret.value='';box.remove();};box.append(secret,copy,done);dialog.insertBefore(box,list);status.textContent='链接只显示一次，请保存后关闭。';delete result.token;delete result.url;await reload();
 }catch(error){if(same())status.textContent=error.code==='TIMEOUT'?'创建结果未确认，请刷新列表核对；不要重复点击。':error.message;}finally{busy=false;create.disabled=false;}};
 try{await reload();}catch(error){if(same())status.textContent=error.message;}
 return {close:finish};
}
