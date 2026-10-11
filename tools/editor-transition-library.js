/** Integration patches; the archived editor stays unchanged. */
export function patchTransitionLibrary(source){
  const replace=(label,needle,value)=>{
    const hits=source.split(needle).length-1;
    if(hits!==1)throw Error(`${label}: expected one exact source match, got ${hits}`);
    source=source.replace(needle,()=>value);
  };
  const gallery=source.split('\n').find(line=>line.startsWith("      group('页面切换',"));
  replace('compact transition selector',gallery,"      group('页面切换',ribbonSelect('切换效果','transition',TRANSITIONS,slide.transition)),");
  const directions=['left','right','up','down'];
  const labels=['向左','向右','向上','向下'];
  const additions=['push','wipe','cover','uncover'].flatMap((effect)=>directions.map((direction,i)=>[`${effect}-${direction}`,`${{push:'推进',wipe:'擦除',cover:'覆盖',uncover:'揭开'}[effect]}${labels[i]}`]));
  additions.push(['split-horizontal','水平劈裂'],['split-vertical','垂直劈裂'],['circle','圆形扩展'],['diamond','菱形扩展']);
  replace('transition gallery',"['slide','平移 Slide'],", "['slide','平移 Slide'],"+additions.map(pair=>JSON.stringify(pair)).join(',')+',');
  replace('legacy transition aliases',"(s.transition==='push'||s.transition==='wipe'?'slide':'fade')","({push:'push-left',wipe:'wipe-left'}[s.transition]||'fade')");
  replace('playback transition aliases',"({push:'slide',wipe:'slide'}[transition]||transition||'fade')","({push:'push-left',wipe:'wipe-left'}[transition]||transition||'fade')");
  const native="['none','fade','slide','convex','concave','zoom']";
  replace('supported effects',`const V14_REVEAL_FX=${native};`,`const V14_BACKGROUND_FX=${native};\n  const V14_REVEAL_FX=[...V14_BACKGROUND_FX,${additions.map(([id])=>JSON.stringify(id)).join(',')}];`);
  for(const expression of ['raw.motion?.backgroundTransition','s.backgroundTransition','bg']){
    replace('native background '+expression,`V14_REVEAL_FX.includes(${expression})`,`V14_BACKGROUND_FX.includes(${expression})`);
  }
  replace('background choices',"v14OptionHTML(V14_REVEAL_FX.map(x=>[x,x]),slide.backgroundTransition||'fade')","v14OptionHTML(V14_BACKGROUND_FX.map(x=>[x,x]),slide.backgroundTransition||'fade')");
  for(const field of ['transitionEnter','transitionExit']){
    replace('label '+field,`v14OptionHTML(V14_REVEAL_FX.map(x=>[x,x]),slide.${field}` ,`v14OptionHTML(V14_REVEAL_FX.map(x=>[x,TRANSITIONS.find(([id])=>id===x)?.[1]||x]),slide.${field}`);
  }
  const vectors={left:['100%','0','-100%','0'],right:['-100%','0','100%','0'],up:['0','100%','0','-100%'],down:['0','-100%','0','100%']};
  // A wipe reveals the incoming page from the opposite edge and removes the outgoing page toward its direction.
  const clips={left:['inset(0 0 0 100%)','inset(0 100% 0 0)'],right:['inset(0 100% 0 0)','inset(0 0 0 100%)'],up:['inset(100% 0 0 0)','inset(0 0 100% 0)'],down:['inset(0 0 100% 0)','inset(100% 0 0 0)']};
  const geometry={};
  for(const direction of directions){
    const v=vectors[direction],visible={opacity:1,transform:'translate(0,0)'},incoming={opacity:1,transform:`translate(${v[0]},${v[1]})`},outgoing={opacity:1,transform:`translate(${v[2]},${v[3]})`};
    geometry['push-'+direction]={in:incoming,out:outgoing,visible};
    geometry['cover-'+direction]={in:incoming,out:visible,visible};
    geometry['uncover-'+direction]={in:visible,out:outgoing,visible};
    geometry['wipe-'+direction]={in:{opacity:1,clipPath:clips[direction][0]},out:{opacity:1,clipPath:clips[direction][1]},visible:{opacity:1,clipPath:'inset(0)'}};
  }
  for(const [id,hidden,visible] of [
    ['split-horizontal','inset(50% 0 50% 0)','inset(0)'],
    ['split-vertical','inset(0 50% 0 50%)','inset(0)'],
    ['circle','circle(0% at 50% 50%)','circle(71% at 50% 50%)'],
    ['diamond','polygon(50% 50%,50% 50%,50% 50%,50% 50%)','polygon(50% -50%,150% 50%,50% 150%,-50% 50%)']
  ])geometry[id]={in:{opacity:1,clipPath:hidden},out:{opacity:1,clipPath:hidden},visible:{opacity:1,clipPath:visible}};
  const selector=(id,state,suffix)=>`.reveal .slides section[data-transition="${id}"].${state},.reveal .slides section[data-transition~="${id}-${suffix}"].${state}`;
  const properties=frame=>Object.entries(frame).map(([key,value])=>`${key==='clipPath'?'clip-path':key}:${value}`).join(';');
  let css='';
  for(const [id] of additions){
    const g=geometry[id],base=`.reveal .slides section[data-transition="${id}"],.reveal .slides section[data-transition~="${id}-in"],.reveal .slides section[data-transition~="${id}-out"]`;
    css+=`${base}{transition-property:opacity,transform,clip-path;transition-timing-function:cubic-bezier(.22,1,.36,1)}`;
    css+=`${base.split(',').map(s=>s+'.present').join(',')}{${properties(g.visible)}}`;
    css+=`${selector(id,'future','in')}{${properties(g.in)}${id.startsWith('uncover-')?';z-index:0':''}}`;
    css+=`${selector(id,'past','out')}{${properties(g.out)}${id.startsWith('uncover-')?';z-index:12':id.startsWith('cover-')?';z-index:0':''}}`;
    if(id.startsWith('cover-')||id.startsWith('uncover-')){
      const reverse=id.startsWith('uncover-')?geometry[id.replace('uncover-','push-')].in:g.visible;
      css+=`.reveal .slides section[data-transition~="${id}-out"].future{${properties(reverse)};z-index:${id.startsWith('uncover-')?12:0}}`;
    }
    css+=`${base.split(',').map(s=>'.reveal.overview '+s.replace('.reveal ','')).join(',')}{transform:none!important;clip-path:none!important;z-index:auto!important}`;
  }
  css+='.reveal .slides section[data-transition~=sp-hold-out].past,.reveal .slides section[data-transition~=sp-hold-out].future{opacity:1;transform:none;clip-path:none;z-index:0}';
  css+='@media(prefers-reduced-motion:reduce){.reveal .slides section.sp-reveal-section{transition:none!important;transform:none!important;clip-path:none!important}.reveal .slides section.sp-reveal-section.past,.reveal .slides section.sp-reveal-section.future{opacity:0!important}}';
  replace('shared playback stylesheet','`+v15ExportCSS();}', '`+v15ExportCSS()+'+JSON.stringify(css)+';}');
  const frames=`      const geometry=${JSON.stringify(geometry)};\n      if(geometry[fx]){const g=geometry[fx];return enter?[g.in,g.visible]:[g.visible,g.out];}\n`;
  replace('preview frames',"      if(fx==='zoom')return enter?", frames+"      if(fx==='zoom')return enter?");
  replace('explicit slide exit marker','sec.dataset.transition=v14TransitionSpec(s);','sec.dataset.transition=v14TransitionSpec(s);sec.dataset.spTransitionExit=String(!!s.transitionExit);');
  replace('preview cover/uncover pair',"const outFX=from.transitionExit||revealTransition(from.transition),inFX=to.transitionEnter||revealTransition(to.transition);", "const inFX=to.transitionEnter||revealTransition(to.transition),paired=/^(cover|uncover)-/.test(inFX),hold=/^(circle|diamond|split-horizontal|split-vertical)$/.test(inFX)&&!from.transitionExit,outFX=hold?'none':paired?inFX:(from.transitionExit||revealTransition(from.transition));\n      old.style.zIndex=inFX.startsWith('uncover-')?'2':'0';neo.style.zIndex='1';");
  replace('preview holds unconfigured previous exit',"if(outFrames)play(old,outFrames);else old.style.opacity='0';","if(outFrames)play(old,outFrames);else old.style.opacity=hold?'1':'0';");
  replace('playback paired transition state',"      let autoTimer=0,autoToken=0;const reduce=", "      let pairedPage=null,pairedAnimation=null,pairedTransition='',pairedSpeed='';\n      function clearPairedTransition(){pairedAnimation?.cancel();pairedAnimation=null;if(pairedPage){pairedPage.dataset.transition=pairedTransition;pairedPage.dataset.transitionSpeed=pairedSpeed;pairedPage=null;}}\n      function pairTransition(ev){clearPairedTransition();const current=ev.currentSlide,previous=ev.previousSlide;\n        const effect=(current?.dataset.transition||'').split(' ').find(id=>(/^(cover|uncover)-/.test(id)||/^(circle|diamond|split-horizontal|split-vertical)(-in)?$/.test(id))&&!id.endsWith('-out'))?.replace(/-in$/,'');\n        const hold=/^(circle|diamond|split-horizontal|split-vertical)$/.test(effect)&&previous?.dataset.spTransitionExit!=='true';\n        if(previous&&effect&&(hold||/^(cover|uncover)-/.test(effect))&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){pairedPage=previous;pairedTransition=previous.dataset.transition;pairedSpeed=previous.dataset.transitionSpeed;previous.dataset.transition=hold?'sp-hold-out':effect+'-out';previous.dataset.transitionSpeed=current.dataset.transitionSpeed;\n          if(effect.startsWith('cover-')&&(current.compareDocumentPosition(previous)&4)&&current.animate){const v="+JSON.stringify(vectors)+"[effect.slice(6)];pairedAnimation=current.animate([{transform:'translate('+v[2]+','+v[3]+')'},{transform:'translate(0,0)'}],{duration:{fast:400,slow:1200}[current.dataset.transitionSpeed]||800,easing:'cubic-bezier(.22,1,.36,1)'});}\n        }\n      }\n      let autoTimer=0,autoToken=0;const reduce=");
  replace('playback pair on navigation',"reveal.on('slidechanged',ev=>{clearTimeout(autoTimer);autoToken++;sync(ev.currentSlide);});", "reveal.on('slidechanged',ev=>{clearTimeout(autoTimer);autoToken++;pairTransition(ev);sync(ev.currentSlide);});");
  replace('playback pair disposal',"return {sync,dispose:()=>{clearTimeout(autoTimer);autoToken++;}};", "return {sync,dispose:()=>{clearTimeout(autoTimer);autoToken++;clearPairedTransition();}};");
  replace('preview matching easing',"const easing=to.morphEase||'cubic-bezier(.22,1,.36,1)'","const easing=to.transition==='morph'?(to.morphEase||'cubic-bezier(.22,1,.36,1)'):'cubic-bezier(.22,1,.36,1)'");
  return source;
}
