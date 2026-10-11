/** Integration-only permissions: native clipboard events preserve the opaque iframe boundary. */
export function patchEditorPermissions(source){
 const replace=(label,needle,value)=>{
  const count=source.split(needle).length-1;
  if(count!==1)throw Error(`${label}: expected one exact source match, got ${count}`);
  source=source.replace(needle,()=>value);
 };
 const runtime=String.raw`
  // SP_EDITOR_PERMISSIONS_START
  function spPermissionCopy(payload,label){
    let copied=false;
    if(payload.length<1_200_000&&navigator.userActivation?.isActive){
      const previous=document.activeElement,selection=document.getSelection(),ranges=[];
      for(let i=0;i<(selection?.rangeCount||0);i++)ranges.push(selection.getRangeAt(i).cloneRange());
      const field=document.createElement('textarea');field.value=payload;field.setAttribute('aria-label','复制到系统剪贴板');field.style.cssText='position:fixed;left:-10000px;top:0';document.body.append(field);
      let written=false;const onCopy=e=>{if(!e.clipboardData)return;e.clipboardData.setData('text/plain',payload);e.preventDefault();written=true;};
      document.addEventListener('copy',onCopy,{once:true});
      try{field.focus();field.select();copied=!!document.execCommand('copy')&&written;}catch(error){}
      finally{document.removeEventListener('copy',onCopy);field.remove();previous?.focus?.();selection?.removeAllRanges();ranges.forEach(range=>selection?.addRange(range));}
    }
    toast(copied?label+'；已复制到系统剪贴板':label+'；仅保留在本编辑器，系统复制不可用。请在本编辑器内粘贴。',!copied);
  }
  function spPermissionPreparePaste(){
    if(spBridgeReadOnly||window.__SPEmbeddedGate?.locked||presentation.active||isTyping()||document.querySelector('dialog[open]')||!$('#v10-file-shade').hidden)return;
    if(document.getElementById('sp-permission-paste-sink'))return;
    const previous=document.activeElement,epoch=spBridgeEpoch,slideId=curSlide()?.id;
    const sink=document.createElement('textarea');sink.id='sp-permission-paste-sink';sink.setAttribute('aria-label','接收系统粘贴');sink.style.cssText='position:fixed;left:-10000px;top:0';
    const current=()=>!spBridgeReadOnly&&!window.__SPEmbeddedGate?.locked&&!presentation.active&&spBridgeEpoch===epoch&&curSlide()?.id===slideId;
    const cleanup=()=>{clearTimeout(timer);const restore=document.activeElement===sink;sink.remove();if(restore)previous?.focus?.();};
    const timer=setTimeout(()=>{
      cleanup();
      if(!current()){toast('编辑会话已改变，未粘贴系统内容，请在当前文稿重试',true);return;}
      if(v11SlideFocus&&v11SlideClipboard?.length){v11PasteSlides();return;}
      if(objectClipboard?.length){pasteObjects();return;}
      toast('未收到系统粘贴。请按 Ctrl / ⌘ + Shift + V 打开手动粘贴文字。',true);
    },350);
    sink.addEventListener('paste',e=>{
      if(!current()){e.preventDefault();e.stopImmediatePropagation();toast('编辑会话已改变，未粘贴系统内容，请在当前文稿重试',true);}
      queueMicrotask(cleanup);
    },{once:true});
    document.body.append(sink);sink.focus();
  }
  async function spPermissionFullscreen(overlay){
    if(!overlay?.requestFullscreen){v16.fullscreenRequested=false;toast('此浏览器不支持全屏，可继续使用窗口放映',true);return;}
    try{await overlay.requestFullscreen();v16.didFullscreen=!!document.fullscreenElement;}
    catch(error){v16.fullscreenRequested=false;toast('浏览器拒绝全屏请求，可继续使用窗口放映，或点击放映工具栏“全屏”重试',true);}
  }
  function spPermissionPasteText(){
    const existing=document.getElementById('sp-permission-paste');if(existing){existing.querySelector('textarea').focus();return;}
    const previous=document.activeElement,dialog=document.createElement('dialog');dialog.id='sp-permission-paste';
    dialog.setAttribute('aria-labelledby','sp-permission-paste-title');
    dialog.innerHTML='<h2 id="sp-permission-paste-title">粘贴纯文本</h2><p>在下方按 Ctrl / ⌘ + V 粘贴系统文字，然后选择插入。编辑器不自动读取系统剪贴板。</p><textarea aria-label="要插入的纯文本" rows="7" maxlength="10000" style="width:100%;box-sizing:border-box"></textarea><p role="status" aria-live="polite"></p><button type="button" data-paste-cancel>取消</button> <button type="button" data-paste-insert>插入文字</button>';
    dialog.style.cssText='max-width:min(520px,85vw);border:1px solid #ccc;border-radius:12px;padding:20px';
    document.body.append(dialog);
    dialog.addEventListener('close',()=>{dialog.remove();previous?.focus?.();},{once:true});
    dialog.querySelector('[data-paste-cancel]').addEventListener('click',()=>dialog.close());
    dialog.querySelector('[data-paste-insert]').addEventListener('click',()=>{
      const value=dialog.querySelector('textarea').value;
      const status=dialog.querySelector('[role="status"]');
      if(!value.trim()){status.textContent='请先粘贴要插入的文字。';return;}
      if(value.startsWith(V11_NATIVE_CLIP)||value.startsWith(V11_NATIVE_SLIDES)){status.textContent='这是 Superior Point 对象或页面，请取消后使用常规粘贴。';return;}
      if(value.length>10000){status.textContent='文字粘贴上限为 10,000 字符，请缩短后重试。';return;}
      // The writer may have closed while the manual paste dialog was open.
      if(spBridgeReadOnly||window.__SPEmbeddedGate?.locked){status.textContent='项目当前不可编辑；文字仍保留，可复制后取消。';return;}
      addObject(makeText(value,155,176,780,Math.max(95,Math.min(420,90+value.split('\n').length*42)),28,'#161715',false,{name:'纯文本'}));
      dialog.close();toast('已按纯文本插入，可继续设置字体');
    });
    dialog.showModal();dialog.querySelector('textarea').focus();
  }
  // SP_EDITOR_PERMISSIONS_END
`;
 replace('native paste sink is not text editing',"  function isTyping(){const e=document.activeElement;return e&&(e.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(e.tagName));}","  function isTyping(){const e=document.activeElement;return e&&e.id!=='sp-permission-paste-sink'&&(e.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(e.tagName));}");
 replace('prepare native paste before internal clipboard shortcuts','    if(meta&&e.shiftKey&&key===\'v\'){e.preventDefault();v11PastePlainText();return;}',"    if(meta&&e.shiftKey&&key==='v'){e.preventDefault();v11PastePlainText();return;}\n    if(meta&&key==='v'){spPermissionPreparePaste();return;}");
 replace('paste handler respects writer state',"      if(presentation.active||isTyping()||!$('#v10-file-shade').hidden)return;","      if(presentation.active||spBridgeReadOnly||window.__SPEmbeddedGate?.locked||isTyping()||!$('#v10-file-shade').hidden)return;");
 replace('empty system clipboard preserves slide context','      if(objectClipboard?.length){e.preventDefault();pasteObjects();}',"      if(v11SlideFocus&&v11SlideClipboard?.length){e.preventDefault();v11PasteSlides();return;}\n      if(objectClipboard?.length){e.preventDefault();pasteObjects();return;}\n      toast('剪贴板没有可用内容，请使用手动粘贴文字。',true);");
 replace('native slide copy',source.split('\n').find(line=>line.startsWith('  function v11CopySlides(){')),runtime+`\n  function v11CopySlides(){const slides=v11SlideSelected();v11SlideClipboard=clone(slides);v11SlideFocus=true;v11RefreshSlideUI();spPermissionCopy(V11_NATIVE_SLIDES+JSON.stringify(v11SlideClipboard),\`已复制 \${slides.length} 页\`);}`);
 const from=source.indexOf('  async function v11PastePlainText(){'),to=source.indexOf('  // ===== /v11 HOME =====',from);
 if(from<0||to<from)throw Error('manual paste: missing source boundary');
 replace('manual plain-text paste',source.slice(from,to),'  async function v11PastePlainText(){spPermissionPasteText();}\n');
 const copyStart=source.indexOf('  function copyObjects(){'),copyEnd=source.indexOf('  function pasteObjects(){',copyStart);
 if(copyStart<0||copyEnd<copyStart)throw Error('object copy: missing source boundary');
 replace('native object copy',source.slice(copyStart,copyEnd),`  function copyObjects(){\n    if(!selectedIds.length)return;objectClipboard=clone(selectedObjects());pasteCount=0;\n    spPermissionCopy(V11_NATIVE_CLIP+JSON.stringify(objectClipboard),\`已复制 \${objectClipboard.length} 个对象\`);\n  }\n`);
 replace('fullscreen toggle result',"    try{await $('#present-overlay').requestFullscreen?.();v16.didFullscreen=!!document.fullscreenElement;}\n    catch(e){v16.fullscreenRequested=false;toast('浏览器拒绝全屏请求，可继续使用窗口放映',true);}","    await spPermissionFullscreen($('#present-overlay'));");
 replace('fallback fullscreen result',"    if(v16.fullscreenRequested)try{await $('#present-overlay').requestFullscreen?.();v16.didFullscreen=!!document.fullscreenElement;}catch(e){/* window fallback */}","    if(v16.fullscreenRequested)await spPermissionFullscreen($('#present-overlay'));");
 replace('request fullscreen before asynchronous Reveal initialization','    const slides=document.createElement(\'div\');slides.className=\'slides\';revealSlideSections().forEach(s=>slides.append(s));root.append(slides);view.append(root);',"    const slides=document.createElement('div');slides.className='slides';revealSlideSections().forEach(s=>slides.append(s));root.append(slides);view.append(root);\n    const spFullscreenStart=v16.fullscreenRequested?spPermissionFullscreen(overlay):Promise.resolve();");
 replace('wait for fullscreen result',"      if(v16.fullscreenRequested)try{await overlay.requestFullscreen?.();v16.didFullscreen=!!document.fullscreenElement;}catch(e){/* CSS fallback */}","      await spFullscreenStart;");
 return source;
}
