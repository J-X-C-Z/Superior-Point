/** Editor-only selection UI; previews never touch slide data. */
export function patchEffectGallery(source){
  const replace=(label,needle,value)=>{
    const hits=source.split(needle).length-1;
    if(hits!==1)throw Error(`${label}: expected one exact source match, got ${hits}`);
    source=source.replace(needle,()=>value);
  };
  const start='    const effectFrames=(kind,name)=>{',end='\n    if(!duration)';
  const from=source.indexOf(start),to=source.indexOf(end,from);
  if(from<0||to<from)throw Error('effect gallery: missing shared transition preview frames');
  const body=source.slice(from+start.length,to).replace(/\n    };$/,'');
  replace('shared transition thumbnail frames',source.slice(from,to),'    const effectFrames=spEffectTransitionFrames;');
  const ui=String.raw`
  // SP_EFFECT_GALLERY_START
  function spEffectTransitionFrames(kind,name){TRANSITION_FRAMES}
  function spEffectCanAdd(){return selectedObjects().some(o=>!o.locked&&o.visible!==false);}
  function spEffectCard(type,id,name,kind=''){
    const isTransition=type==='transition',obj=selectedObject();
    const chosen=isTransition?curSlide()?.transition===id:v15Effects(obj).some(f=>f.kind===kind&&f.effect===id);
    const disabled=!isTransition&&!spEffectCanAdd();
    const label=name.replace(/\s+(Fade|Slide|Zoom|Convex|Concave|None|Morph)$/,'');
    return '<button type="button" class="sp-effect-card '+(chosen?'is-selected ':'')+(kind?'sp-effect-'+kind:'')+'" data-sp-effect-type="'+type+'" data-sp-effect-id="'+id+'" data-sp-effect-kind="'+kind+'" data-action="'+(isTransition?'choose-transition':'v15-preset')+'" data-value="'+(isTransition?id:kind+':'+id)+'" aria-pressed="'+chosen+'" '+(disabled?'disabled ':'')+'title="'+safe(label)+(id==='morph'?' · 示意预览':disabled?' · 请先选中可编辑对象':' · 悬停预览，单击'+(isTransition?'应用到当前页':'添加动画'))+'"><span class="sp-effect-stage" aria-hidden="true">'+(isTransition?'<i class="sp-effect-old"><b>A</b><em></em></i><i class="sp-effect-new"><b>B</b><em></em></i>':'<i class="sp-effect-object">Aa</i>')+'</span><span class="sp-effect-name">'+safe(label)+'</span>'+(chosen?'<span class="sp-effect-check" aria-hidden="true">✓</span>':'')+'</button>';
  }
  function spEffectRibbon(type){
    const featured=type==='transition'?['none','fade','push-left','wipe-left','zoom','morph']:['entrance:fade','entrance:fade-left','entrance:zoom','emphasis:pulse','emphasis:spin','exit:fade'];
    const cards=featured.map(key=>{
      if(type==='transition'){const item=TRANSITIONS.find(([id])=>id===key);return item?spEffectCard(type,...item):'';}
      const [kind,id]=key.split(':'),item=V15_EFFECTS[kind].find(([fx])=>fx===id);return item?spEffectCard(type,...item,kind):'';
    }).join('');
    return '<div class="sp-effect-strip" role="group" aria-label="'+(type==='transition'?'切换效果':'动画效果')+'">'+cards+'<button type="button" class="sp-effect-more" data-sp-effect-open="'+type+'" aria-haspopup="dialog" title="浏览全部'+(type==='transition'?'切换':'动画')+'效果">全部'+(type==='transition'?'切换':'动画')+' <span aria-hidden="true">⌄</span></button></div>';
  }
  let spEffectPreviewCard=null,spEffectPreviewAnimations=[],spEffectReturnFocus=null;
  function spEffectStopPreview(){
    spEffectPreviewAnimations.forEach(a=>a.cancel());spEffectPreviewAnimations=[];
    if(spEffectPreviewCard){spEffectPreviewCard.classList.remove('is-previewing');spEffectPreviewCard.querySelector('.sp-effect-old')?.style.removeProperty('z-index');spEffectPreviewCard=null;}
  }
  function spEffectPreview(card,keyboard=false){
    if(card===spEffectPreviewCard)return;
    spEffectStopPreview();
    if(!card||matchMedia('(prefers-reduced-motion: reduce)').matches||(!keyboard&&!matchMedia('(hover: hover) and (pointer: fine)').matches))return;
    spEffectPreviewCard=card;card.classList.add('is-previewing');
    const play=(selector,frames,options={})=>{const node=card.querySelector(selector);if(!node?.animate||!frames)return;try{spEffectPreviewAnimations.push(node.animate(frames,{duration:650,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards',...options}));}catch(error){}};
    const id=card.dataset.spEffectId;
    if(card.dataset.spEffectType==='animation')play('.sp-effect-object',v15Frames({kind:card.dataset.spEffectKind,effect:id}),{easing:'ease-out'});
    else if(id==='morph'){
      play('.sp-effect-old',[{opacity:1},{opacity:0}]);
      play('.sp-effect-new',[{opacity:0,transform:'translate(-18%,12%) scale(.65)'},{opacity:1,transform:'translate(0,0) scale(1)'}]);
    }else{
      const hold=/^(circle|diamond|split-horizontal|split-vertical)$/.test(id);
      if(id.startsWith('uncover-'))card.querySelector('.sp-effect-old').style.zIndex='2';
      play('.sp-effect-old',hold?[{opacity:1},{opacity:1}]:spEffectTransitionFrames('out',id));
      play('.sp-effect-new',spEffectTransitionFrames('in',id));
    }
  }
  function spEffectClose(returnFocus=true){
    spEffectStopPreview();document.getElementById('sp-effect-shade')?.remove();
    const opener=spEffectReturnFocus?.isConnected?spEffectReturnFocus:document.querySelector('[data-sp-effect-open="'+spEffectReturnFocus?.dataset.spEffectOpen+'"]');
    if(returnFocus)opener?.focus();spEffectReturnFocus=null;
  }
  function spEffectOpen(type,opener){
    spEffectClose(false);spEffectReturnFocus=opener;
    const shade=document.createElement('div');shade.id='sp-effect-shade';shade.className='sp-effect-shade';
    const title=type==='transition'?'全部切换效果':'全部动画效果';
    const note=type==='transition'?'悬停预览 · 单击应用到当前页；平滑为示意，实际效果取决于相邻页对象配对':spEffectCanAdd()?'悬停预览 · 每次单击为选中对象添加一段动画':'先在画布选中可编辑对象，再添加动画；悬停仍可查看效果';
    const sections=type==='transition'?'<div class="sp-effect-grid">'+TRANSITIONS.map(item=>spEffectCard(type,...item)).join('')+'</div>':V15_KINDS.map(([kind,label])=>'<section class="sp-effect-section sp-effect-'+kind+'"><h3>'+label+'</h3><div class="sp-effect-grid">'+V15_EFFECTS[kind].map(item=>spEffectCard(type,...item,kind)).join('')+'</div></section>').join('');
    shade.innerHTML='<section class="sp-effect-panel" role="dialog" aria-modal="true" aria-labelledby="sp-effect-title" tabindex="-1"><header class="sp-effect-panel-head"><h2 id="sp-effect-title">'+title+'</h2><button type="button" data-sp-effect-close aria-label="关闭效果库">×</button></header><p class="sp-effect-panel-note">'+note+'</p>'+sections+'</section>';
    document.body.append(shade);shade.querySelector('.sp-effect-panel').focus();
  }
  function spEffectGalleryBoot(){
    document.addEventListener('pointerover',e=>{const card=e.target.closest('.sp-effect-card');if(card&&!card.contains(e.relatedTarget))spEffectPreview(card);});
    document.addEventListener('pointerout',e=>{const card=e.target.closest('.sp-effect-card');if(card&&!card.contains(e.relatedTarget))spEffectStopPreview();});
    document.addEventListener('focusin',e=>{if(e.target.matches('.sp-effect-card'))spEffectPreview(e.target,true);});
    document.addEventListener('focusout',e=>{if(e.target===spEffectPreviewCard)spEffectStopPreview();});
    document.addEventListener('click',e=>{
      const open=e.target.closest('[data-sp-effect-open]');
      if(open){spEffectOpen(open.dataset.spEffectOpen,open);return;}
      if(e.target.id==='sp-effect-shade'||e.target.closest('[data-sp-effect-close]')){spEffectClose();return;}
      if(e.target.closest('[data-tab]'))spEffectClose(false);
      const card=e.target.closest('.sp-effect-card');
      if(card&&!card.disabled){spEffectStopPreview();if(card.closest('#sp-effect-shade'))queueMicrotask(()=>spEffectClose());}
    },true);
    document.addEventListener('keydown',e=>{
      const shade=document.getElementById('sp-effect-shade');if(!shade)return;
      e.stopImmediatePropagation();
      if(e.key==='Escape'){e.preventDefault();spEffectClose();return;}
      if(e.key==='Tab'){
        const buttons=[...shade.querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);
        if(e.shiftKey&&(document.activeElement===first||document.activeElement===shade.querySelector('.sp-effect-panel'))){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&(document.activeElement===last||!shade.contains(document.activeElement))){e.preventDefault();first?.focus();}
      }
    },true);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)spEffectClose(false);});
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',spEffectStopPreview);
    matchMedia('(hover: hover) and (pointer: fine)').addEventListener('change',spEffectStopPreview);
  }
  // SP_EFFECT_GALLERY_END
`;
  replace('effect gallery helpers','  function renderRibbon(){',ui.replace('TRANSITION_FRAMES',body)+'\n  function renderRibbon(){spEffectStopPreview();');
  const transition=source.split('\n').find(line=>line.startsWith("      group('页面切换',"));
  replace('visual transition ribbon',transition,"      group('页面切换',spEffectRibbon('transition')),");
  const animation=source.split('\n').find(line=>line.startsWith("      group('快速添加',"));
  replace('visual animation ribbon',animation,"      group('动画效果',spEffectRibbon('animation')),");
  const settings=source.split('\n').find(line=>line.startsWith("      group('效果设置',"));
  replace('remove duplicate dropdown animation add',settings,"      group('添加提示',`<span class=\"sp-effect-ribbon-note\">${spEffectCanAdd()?'单击效果卡片即可添加动画':'先选中可编辑对象，再添加动画'}<br>悬停预览 · 已添加效果显示 ✓</span>`),");
  replace('boot effect gallery','  function bindEvents(){','  function bindEvents(){spEffectGalleryBoot();');
  return source;
}
