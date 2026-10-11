const bytes=value=>value>=1048576?(value/1048576).toFixed(1)+' MiB':(value/1024).toFixed(1)+' KiB';
export async function openStorageUsage({api,document=globalThis.document}){
 const accountId=api.user?.id,previous=document.activeElement,dialog=document.createElement('dialog');
 if(!accountId)throw Error('请先登录。');
 const title=document.createElement('h2'),status=document.createElement('p'),list=document.createElement('dl'),close=document.createElement('button');title.textContent='存储用量';title.id='storage-usage-title';dialog.setAttribute('aria-labelledby',title.id);status.setAttribute('role','status');status.textContent='正在读取用量…';close.type='button';close.textContent='关闭';
 const finish=()=>{dialog.close?.();dialog.remove();previous?.focus?.();};close.onclick=finish;dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});dialog.append(title,status,list,close);document.body.append(dialog);dialog.showModal?.();
 try{const value=await api.request('/me/storage');if(!dialog.isConnected)return;if(api.user?.id!==accountId){status.textContent='账号已变更，请关闭后重新打开。';return;}
  status.textContent=value.overQuota?'已超过配额。可以读取、导出或缩小文稿；新增内容受限。':value.warning?'用量已达到预警线。':'当前用量在配额范围内。';
  for(const [name,text]of [['活跃项目',`${value.usage.activeProjects} / ${value.limits.maxProjects}`],['留存内容',`${bytes(value.usage.totalBytes)} / ${bytes(value.limits.maxBytes)}`],['历史版本',bytes(value.usage.historyBytes)],['分享页面',bytes(value.usage.shareBytes)],['回收站项目',value.usage.trashedProjects],['计量说明','包含历史、回收站、主题和分享页面；移入回收站不会释放留存内容。']]){const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=name;description.textContent=String(text);list.append(term,description);}
 }catch(error){if(dialog.isConnected)status.textContent=error.message||'无法读取存储用量。';}
 return {close:finish};
}
