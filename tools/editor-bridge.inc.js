  // Integration-only bridge. This code lives inside the preserved editor closure.
  // Data enters only as structured-cloned JSON; imported HTML is never evaluated.
  const spBridgeChannel='__SP_BRIDGE_CHANNEL__';
  let spBridgeWorkspaceState=null;
  let spBridgeHistory={canUndo:false,canRedo:false};
  let spBridgeThemeEntry=null;
  let spBridgeStarted=false,spBridgeReadOnly=true,spBridgeRevision=0,spBridgeEpoch=0;
  let spBridgeBaseline=null,spBridgeLatest='',spBridgeSending=null,spBridgeQueue=[],spBridgeSequence=0;
  let spBridgeFailure=null,spBridgeCapturing=false,spBridgeComposing=false;
  let v15Dragging=null;
  let spBridgeWaiters=[],spBridgeCommandSerial=Promise.resolve();
  const spBridgeClone=value=>JSON.parse(JSON.stringify(value));
  const spBridgePost=(type,data={})=>parent.postMessage({spCandidate:1,channel:spBridgeChannel,type,...data},'*');
  function spBridgeStatus(){
    if(!spBridgeStarted)return;
    // End the gesture at its current draft; cancelling would discard recovery data.
    if(spBridgeReadOnly&&(drag||timingDrag||v15Dragging)){drag=null;timingDrag=null;v15Dragging=null;renderCanvas();renderTimeline();}
    const pending=!!spBridgeSending||spBridgeQueue.length>0;
    // A pending commit is already isolated in the snapshot queue. Blocking input
    // here would silently swallow real keystrokes between postMessage and ack.
    window.__SPEmbeddedGate.locked=!spBridgeStarted||spBridgeReadOnly||!!spBridgeFailure;
    const status=$('#save-status');if(status)status.textContent=spBridgeFailure?'修改未提交 · 已保留恢复数据':spBridgeReadOnly?'只读 · 写入权由工作台管理':pending?'正在提交修改…':spBridgeWorkspaceState?.text||'正在读取保存状态…';
    if(status){status.dataset.failed=String(!!spBridgeFailure||!!spBridgeWorkspaceState?.failed);status.title=status.textContent;}
    $('#save-indicator')?.classList.toggle('unsaved',pending||!!spBridgeWorkspaceState?.failed);
    const details=document.querySelector('.sp-workspace-details');if(details){details.textContent=spBridgeWorkspaceState?.details||'';details.hidden=!details.textContent;}
    const blocker=$('#sp-candidate-lock');
    if(blocker){blocker.hidden=!spBridgeReadOnly;blocker.textContent=spBridgeFailure?'修改未提交，已保留恢复数据。请用上方恢复或备份。':'当前项目只读。请在上方工作台获取写入权。';}
    document.documentElement.dataset.spCandidatePending=String(pending);
  }
  function spBridgeUnavailable(){toast('请使用上方项目工作台管理、导入或备份项目。候选编辑器不单独保存项目。',true);return true;}
  function spBridgeAction(action){
    if(!spBridgeStarted||spBridgeReadOnly)return true;
    if(action==='sp-workspace-home'){spBridgeCommand('home');return true;}
    if(action==='sp-workspace-json'||action==='sp-workspace-audience'){spBridgeCommand('export',{format:action==='sp-workspace-json'?'json':'audience'});return true;}
    if(action==='sp-theme-entry'){spBridgeCommand('themes');return true;}
    if(action==='v10-export-package'){toast('ZIP 项目包尚未接入候选工作台。请先使用上方 HTML 导出或 JSON 备份。',true);return true;}
    if(action==='export-pptx')toast('将沿用原编辑器的 PPTX 导出；本轮尚未完成其格式兼容验收。');
    if(['v10-file-hub','v10-recent','v10-create-open','new-deck','sp39-new'].includes(action)){spBridgeCommand('home');return true;}
    if(action.startsWith('v10-')||action==='v11-history')return spBridgeUnavailable();
    return false;
  }
  function spBridgeValidate(project){
    const value=spBridgeClone(project);
    if(!value||!Array.isArray(value.slides)||!value.slides.length||value.slides.length>500)throw Error('编辑器需要 1 至 500 张幻灯片');
    if(!Number.isFinite(value.width)||!Number.isFinite(value.height)||value.width<1||value.height<1)throw Error('画布尺寸无效');
    const ids=new Set();for(const slide of value.slides){
      if(!slide||typeof slide.id!=='string'||!slide.id||ids.has(slide.id)||!Array.isArray(slide.objects))throw Error('幻灯片结构或 ID 无效');
      ids.add(slide.id);const objectIds=new Set();for(const object of slide.objects){if(!object||typeof object.id!=='string'||!object.id||objectIds.has(object.id))throw Error('对象 ID 无效');objectIds.add(object.id);}
    }
    return value;
  }
  function spBridgeApply(project,{revision=spBridgeRevision,readOnly=spBridgeReadOnly,epoch=spBridgeEpoch,history=spBridgeHistory,themeEntry=spBridgeThemeEntry}={}){
    const next=spBridgeValidate(project),slideId=deck?.slides?.[slideIndex]?.id,oldSelected=[...selectedIds];
    clearTimeout(notesCommitTimer);clearTimeout(autosaveTimer);
    if(editingId)stopTextEditing(false);
    if(presentation.active)exitPresentation();
    v24Stop();drag=null;deck=next;
    spBridgeRevision=revision;spBridgeEpoch=epoch;spBridgeReadOnly=!!readOnly;spBridgeHistory=history;
    spBridgeThemeEntry=themeEntry&&typeof themeEntry.name==='string'&&typeof themeEntry.version==='string'?{name:themeEntry.name,version:themeEntry.version}:null;
    const match=deck.slides.findIndex(s=>s.id===slideId);slideIndex=match>=0?match:Math.min(slideIndex,deck.slides.length-1);
    const ids=new Set(curSlide().objects.map(o=>o.id));selectedIds=oldSelected.filter(id=>ids.has(id));selectedId=selectedIds.at(-1)||null;
    spBridgeBaseline=spBridgeClone(deck);spBridgeLatest=serialized();undoStates=[spBridgeLatest];undoPosition=0;
    v11SlideIds=[curSlide().id];v11AnchorId=curSlide().id;
    renderAll();spBridgeStatus();requestAnimationFrame(fitCanvas);
  }
  function spBridgeResolveWaiters(error){
    if(!error&&(spBridgeSending||spBridgeQueue.length))return;
    if(!error&&spBridgeWaiters.length&&!spBridgeReadOnly&&!spBridgeFailure){
      // Input remains live while earlier snapshots await an acknowledgement.
      // Flush cannot finish until a newer, not-yet-debounced draft is included.
      spBridgeCaptureDraft();
      if(serialized()!==spBridgeLatest){spBridgeCommit(true);return;}
    }
    const list=spBridgeWaiters.splice(0);for(const waiter of list)error?waiter.reject(error):waiter.resolve();
  }
  function spBridgeSendNext(){
    if(spBridgeSending||!spBridgeQueue.length){spBridgeStatus();spBridgeResolveWaiters();return;}
    spBridgeSending=spBridgeQueue.shift();
    spBridgePost('edit',{project:spBridgeSending.project,sequence:spBridgeSending.sequence,expectedRevision:spBridgeRevision,epoch:spBridgeEpoch});
    spBridgeStatus();
  }
  function spBridgeScheduleAutosave(){
    clearTimeout(autosaveTimer);
    if(!spBridgeStarted||spBridgeReadOnly||spBridgeFailure||spBridgeComposing)return;
    autosaveTimer=setTimeout(()=>{if(!spBridgeComposing)spBridgeCommit(true);},350);
  }
  function spBridgeExportHTML(){
    toast('将导出完整可重编辑 HTML，包含备注、批注及历史。当前不是观众脱敏版。');
    return spBridgeCommand('export',{format:'html'});
  }
  function spBridgeCommit(silent=false){
    if(!spBridgeStarted||spBridgeCapturing)return;
    if(spBridgeReadOnly){if(spBridgeBaseline)spBridgeApply(spBridgeBaseline);return;}
    if(serialized()===spBridgeLatest){v18NextAction='';return;}
    v18RecordChange(spBridgeLatest);
    spBridgeLatest=serialized();undoStates=[spBridgeLatest];undoPosition=0;
    spBridgeQueue.push({project:spBridgeClone(deck),sequence:++spBridgeSequence});spBridgeSendNext();
    if(!silent)renderStatus();
  }
  function spBridgeCaptureDraft(){
    clearTimeout(notesCommitTimer);clearTimeout(autosaveTimer);spBridgeCapturing=true;
    try{if(editingId)stopTextEditing(true);}finally{spBridgeCapturing=false;}
    return serialized();
  }
  function spBridgePreserveFailure(message){
    spBridgeCaptureDraft();
    if(message.rejectedProject&&!spBridgeFailure&&(!spBridgeSending||message.sequence!==spBridgeSending.sequence)){deck=spBridgeValidate(message.rejectedProject);slideIndex=Math.min(slideIndex,deck.slides.length-1);clearSelection();renderAll();}
    spBridgeFailure=Error(message.error||'修改未提交，已保留恢复数据');
    spBridgeSending=null;spBridgeQueue=[];spBridgeReadOnly=true;
    spBridgeRevision=message.revision??spBridgeRevision;spBridgeEpoch=message.epoch??spBridgeEpoch;
    spBridgeLatest=serialized();spBridgeStatus();renderRibbon();
    spBridgeResolveWaiters(spBridgeFailure);
    spBridgePost('recovery',{project:spBridgeClone(deck),epoch:spBridgeEpoch,error:spBridgeFailure.message});
    toast('修改未提交，已保留恢复数据。请用上方恢复或备份。',true);
  }
  function spBridgeFlush(){
    clearTimeout(autosaveTimer);
    if(spBridgeFailure)return Promise.reject(spBridgeFailure);
    if(spBridgeStarted&&!spBridgeReadOnly){
      clearTimeout(notesCommitTimer);
      if(editingId)stopTextEditing(true);
      spBridgeCommit(true);
    }
    if(!spBridgeSending&&!spBridgeQueue.length)return Promise.resolve();
    return new Promise((resolve,reject)=>spBridgeWaiters.push({resolve,reject}));
  }
  function spBridgeCommand(type,data={}){
    const command=spBridgeCommandSerial.catch(()=>{}).then(async()=>{
      await spBridgeFlush();spBridgePost(type,{...data,epoch:spBridgeEpoch,expectedRevision:spBridgeRevision});
    });
    spBridgeCommandSerial=command;command.catch(error=>toast(error.message,true));return command;
  }
  // Strip active content and unsafe URLs from the rendered slide DOM before it
  // can become an independently opened HTML file. Only our fixed playback code
  // and bundled Reveal runtime are inserted after this sanitizer.
  function spBridgeSanitizeTree(root){
    root.querySelectorAll('script,iframe,frame,object,embed,foreignObject,link,meta,base,form,input,textarea,select,button,style').forEach(n=>n.remove());
    for(const node of [root,...root.querySelectorAll('*')]){
      for(const attr of [...node.attributes]){
        const key=attr.name.toLowerCase(),value=attr.value.trim();
        if(key.startsWith('on')||key==='srcdoc'||key==='action'||key==='formaction'||key==='srcset'){node.removeAttribute(attr.name);continue;}
        if(['href','xlink:href','src','poster'].includes(key)){
          const image=/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(value);
          const media=/^data:(?:audio\/(?:mpeg|mp4|wav|ogg|x-wav)|video\/(?:mp4|webm));base64,[a-z0-9+/=\s]+$/i.test(value);
          const link=node.localName==='a'&&/^(?:https?:\/\/|#)/i.test(value);
          if(!image&&!media&&!link&&!/^#[a-zA-Z0-9_-]+$/.test(value))node.removeAttribute(attr.name);
          if(link){node.setAttribute('rel','noopener noreferrer');node.setAttribute('target','_blank');}
        }
        if(key==='style'&&/(?:expression\s*\(|@import|behavior\s*:|-moz-binding|javascript\s*:)/i.test(value))node.removeAttribute('style');
      }
      if(node.hasAttribute('style'))for(const property of [...node.style]){
        const value=node.style.getPropertyValue(property);
        // Only embedded raster backgrounds. No external requests, SVG, or CSS escapes.
        if(/url\s*\(/i.test(value)&&!/^url\(["']?data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+["']?\)$/i.test(value.trim()))node.style.removeProperty(property);
      }
    }
    return root;
  }
  function spBridgeRenderLegacyHTML(){
    const sections=revealSlideSections().map(s=>spBridgeSanitizeTree(s).outerHTML).join('\n');
    const vendor=document.getElementById('sp-candidate-reveal-code').textContent;
    const css=document.getElementById('sp-candidate-reveal-css').textContent;
    const escapeScript=source=>source.replace(/<\/script/gi,'<\\/script');
    const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
    const playback=`${v15PlaybackBootstrap.toString()};v15PlaybackBootstrap();${v24OfflineExportBootstrap.toString()};if(window.Reveal){Reveal.initialize({width:${deck.width},height:${deck.height},margin:.04,hash:true,center:false,controls:true,progress:true,slideNumber:'c/t',transition:matchMedia('(prefers-reduced-motion: reduce)').matches?'none':'fade',backgroundTransition:'fade',autoAnimate:!matchMedia('(prefers-reduced-motion: reduce)').matches,autoAnimateEasing:'cubic-bezier(.2,.8,.2,1)',autoAnimateDuration:.7,autoSlide:0,autoSlideStoppable:true}).then(()=>window.SuperiorPointMotion?.attach(Reveal)).catch(()=>v24OfflineExportBootstrap(${deck.width},${deck.height}));document.querySelector('.reveal')?.addEventListener('click',function(e){const current=Reveal.getCurrentSlide?.();if(current?.dataset.clickAdvance==='false'&&!e.target.closest('a,button,input,video,audio')){e.preventDefault();e.stopImmediatePropagation();}},true);}else{v24OfflineExportBootstrap(${deck.width},${deck.height});}`;
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+policy+'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+safe(deck.name)+' — Superior Point</title><style>'+css+revealStyleSheet()+v24OfflineExportCSS()+'</style></head><body><div class="reveal"><div class="slides">'+sections+'</div></div><script type="application/json" id="superior-point-project">'+safeJSONScript(deck)+'</'+'script><script>'+escapeScript(vendor)+'</'+'script><script>'+escapeScript(playback)+'</'+'script></body></html>';
  }
  function spBridgeBoot(){
    const banner=document.createElement('div');banner.id='sp-candidate-lock';banner.hidden=true;
    Object.assign(banner.style,{position:'fixed',bottom:'36px',left:'50%',transform:'translateX(-50%)',zIndex:99999,padding:'12px 18px',background:'#fff3cd',border:'1px solid #d9aa32',borderRadius:'8px',fontSize:'12px',pointerEvents:'none'});document.body.append(banner);
    window.SPEditorCandidate=Object.freeze({getSnapshot:()=>spBridgeClone(deck),flush:spBridgeFlush,renderLegacyHTML:spBridgeRenderLegacyHTML,getState:()=>({revision:spBridgeRevision,readOnly:spBridgeReadOnly,pending:!!spBridgeSending||!!spBridgeQueue.length,epoch:spBridgeEpoch})});
    document.addEventListener('click',event=>{const menu=document.querySelector('.sp-workspace-share');if(menu&&(!menu.contains(event.target)||event.target.closest('[data-action]')))menu.open=false;});
    document.addEventListener('keydown',event=>{const menu=document.querySelector('.sp-workspace-share');if(event.key==='Escape'&&menu?.open){menu.open=false;menu.querySelector('summary').focus();}});
    document.addEventListener('compositionstart',()=>{spBridgeComposing=true;clearTimeout(autosaveTimer);},true);
    document.addEventListener('compositionend',()=>{spBridgeComposing=false;spBridgeScheduleAutosave();},true);
    spBridgePost('ready',{version:'v0.39-integrated-mimo'});
  }
  async function spBridgeReceive(event){
    const message=event.data;
    if(event.source!==parent||!message||message.spCandidate!==1||message.channel!==spBridgeChannel)return;
    const {type,requestId}=message;
    try{
      if(type==='initialize'){
        if(spBridgeStarted)throw Error('候选编辑器已初始化');
        deck=spBridgeValidate(message.project);spBridgeReadOnly=!!message.readOnly;spBridgeRevision=message.revision;spBridgeEpoch=message.epoch;
        sp39Bind();
        v9LoadPrefs();v19RestorePrefs();v9ApplyLayout();v7SetUIMotion(!matchMedia('(prefers-reduced-motion: reduce)').matches);renderStaticIcons();
        OPTIONS.showNotes=false;
        bindEvents();v17BindEvents();v18BindEvents();v19Bind();spBridgeStarted=true;
        spBridgeApply(deck,message);v8OnViewportChange();sp39UIState();
        if(!window.JSZip||!window.PptxGenJS)warn('基础编辑可用；部分 PPTX 导入/导出依赖未加载。项目导入和保存请使用上方工作台。');
        if(requestId)spBridgePost('response',{requestId,value:true});return;
      }
      if(type==='workspaceState'){spBridgeWorkspaceState=message.state;spBridgeStatus();return;}
      if(!spBridgeStarted)throw Error('候选编辑器尚未初始化');
      if(type==='ack'){
        if(message.epoch!==spBridgeEpoch||message.sequence!==spBridgeSending?.sequence)return;
        spBridgeRevision=message.revision;spBridgeHistory=message.history||spBridgeHistory;renderRibbon();spBridgeBaseline=spBridgeSending.project;spBridgeSending=null;
        spBridgeSendNext();sp39SyncHistory();return;
      }
      if(type==='reject'){spBridgePreserveFailure(message);return;}
      if(type==='update'){
        if(spBridgeFailure)return;
        const dirty=spBridgeCaptureDraft()!==spBridgeLatest;
        if(dirty||spBridgeSending||spBridgeQueue.length){spBridgePreserveFailure({...message,error:'项目已在工作台更新，当前未提交修改已保留用于恢复'});return;}
        const hadPending=spBridgeSending||spBridgeQueue.length;
        spBridgeSending=null;spBridgeQueue=[];
        if(hadPending)spBridgeResolveWaiters(Error(message.error||'项目已更新，未提交的编辑已撤回'));
        spBridgeApply(message.project,message);
        
        if(requestId)spBridgePost('response',{requestId,value:true});return;
      }
      if(type==='readOnly'){
        if(spBridgeFailure)return;
        if(message.value&&!spBridgeReadOnly){
          const changed=spBridgeCaptureDraft()!==spBridgeLatest;
          if(changed||spBridgeSending||spBridgeQueue.length){spBridgePreserveFailure({error:'写入权已失效，最后的修改已保留用于恢复'});return;}
        }
        spBridgeReadOnly=!!message.value;
        spBridgeStatus();renderRibbon();sp39SyncHistory();return;
      }
      if(type==='notice'){toast(message.text,!!message.error);return;}
      if(type==='flush'){await spBridgeFlush();spBridgePost('response',{requestId,value:true});return;}
      if(type==='snapshot'){await spBridgeFlush();spBridgePost('response',{requestId,value:spBridgeClone(deck)});return;}
      if(type==='renderHTML'){await spBridgeFlush();spBridgePost('response',{requestId,value:spBridgeRenderLegacyHTML()});return;}
      if(type==='dispose'){clearTimeout(autosaveTimer);clearTimeout(notesCommitTimer);spBridgeReadOnly=true;spBridgeStatus();return;}
    }catch(error){
      spBridgePost('response',{requestId,error:error.message});
      if(type==='initialize')spBridgePost('fatal',{error:error.message});else toast(error.message,true);
    }
  }
  window.addEventListener('beforeunload',event=>{if(spBridgeFailure||spBridgeSending||spBridgeQueue.length||editingId||(spBridgeStarted&&serialized()!==spBridgeLatest)){event.preventDefault();event.returnValue='';}});
  window.addEventListener('message',spBridgeReceive);
