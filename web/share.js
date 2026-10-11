export async function mountShare({document=globalThis.document,location=globalThis.location,history=globalThis.history,fetch=globalThis.fetch}={}){
 const token=location.hash.slice(1),status=document.querySelector('#share-status'),frame=document.querySelector('#share-frame');
 history.replaceState(null,'',location.pathname+location.search);
 if(!/^sp_share_[A-Za-z0-9_-]{43}$/.test(token)){status.textContent='请重新打开包含完整授权的原分享链接。';return;}
 try{
  const response=await fetch('/api/v1/public/shares/view',{headers:{Authorization:'Bearer '+token},credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('分享链接不可用、已撤销或已到期。');
  const result=await response.json();if(typeof result.html!=='string'||!Number.isSafeInteger(result.revision)||typeof result.title!=='string')throw Error('分享内容暂不可用。');
  frame.setAttribute('sandbox','allow-scripts');frame.srcdoc=result.html;frame.hidden=false;document.querySelector('#share-title').textContent=result.title;status.textContent='只读观众内容 · 固定修订 r'+result.revision;
 }catch(error){frame.hidden=true;status.textContent=error.message||'分享暂不可用，请重新打开原链接。';}
}
if(globalThis.document?.querySelector('#share-frame'))mountShare();
