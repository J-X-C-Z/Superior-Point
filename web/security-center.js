import {formDialog} from './admin/app.js';
export async function openSessionCenter({api,document=globalThis.document,navigate=url=>globalThis.location.assign(url)}){
 const accountId=api.user?.id,previous=document.activeElement;
 if(!accountId)throw Error('请先登录。');
 const dialog=document.createElement('dialog'),heading=document.createElement('h2'),status=document.createElement('p'),list=document.createElement('div'),close=document.createElement('button');
 heading.textContent='活跃登录会话';heading.id='session-center-title';dialog.setAttribute('aria-labelledby',heading.id);status.setAttribute('role','status');close.textContent='关闭';close.type='button';
 const finish=()=>{dialog.close?.();dialog.remove();previous?.focus?.();};close.onclick=finish;dialog.addEventListener('cancel',event=>{event.preventDefault();finish();});dialog.append(heading,status,list,close);document.body.append(dialog);dialog.showModal?.();
 const same=()=>api.user?.id===accountId&&dialog.isConnected;
 async function reload(){
  status.textContent='正在读取会话…';const sessions=await api.request('/me/sessions');if(!same())return;
  list.replaceChildren();status.textContent='仅展示你的有效会话；退出会话不会删除文稿。';
  for(const session of sessions){const row=document.createElement('p'),label=document.createElement('span'),revoke=document.createElement('button');label.textContent=`${session.current?'当前会话 · ':''}${new Date(session.createdAt).toLocaleString('zh-CN')} · 到期 ${new Date(session.expiresAt).toLocaleString('zh-CN')} `;revoke.type='button';revoke.textContent='退出此会话';row.append(label,revoke);list.append(row);
   revoke.onclick=async()=>{if(!same())return;revoke.disabled=true;try{
    if(!await formDialog(document,'退出会话',[],{message:session.current?'当前页面将退出登录，未保存内容请先保留。':'该会话将无法继续访问云端。',confirm:'退出会话'}))return;
    if(!same())return;
    let result;try{result=await api.request('/me/sessions/'+encodeURIComponent(session.id),{method:'DELETE'});}catch(error){if(error.code!=='REAUTHENTICATION_REQUIRED')throw error;const answer=await formDialog(document,'验证当前密码',[{name:'password',label:'当前密码',type:'password',required:true,autocomplete:'current-password'}]);if(!answer)return;try{await api.request('/auth/reauth',{method:'POST',body:{password:answer.password}});}finally{answer.password='';}if(!same())return;result=await api.request('/me/sessions/'+encodeURIComponent(session.id),{method:'DELETE'});}
    if(result.current){finish();navigate('/login');}else await reload();
   }catch(error){if(same())status.textContent=error.message;}finally{revoke.disabled=false;}};
  }
 }
 try{await reload();}catch(error){if(same())status.textContent=error.message;}
 return {close:finish};
}
