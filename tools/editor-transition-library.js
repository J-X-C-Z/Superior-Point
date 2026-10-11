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
  const additions=['push','wipe'].flatMap((effect)=>directions.map((direction,i)=>[`${effect}-${direction}`,`${effect==='push'?'推进':'擦除'}${labels[i]}`]));
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
  const selector=(id,state,suffix)=>`.reveal .slides section[data-transition="${id}"].${state},.reveal .slides section[data-transition~="${id}-${suffix}"].${state}`;
  let css='';
  for(const [id] of additions){
    const [effect,direction]=id.split('-'),vector=vectors[direction],clip=clips[direction];
    const base=`.reveal .slides section[data-transition="${id}"],.reveal .slides section[data-transition~="${id}-in"],.reveal .slides section[data-transition~="${id}-out"]`;
    css+=`${base}{transition-property:opacity,transform,clip-path;transition-timing-function:cubic-bezier(.22,1,.36,1)}`;
    css+=`${base.split(',').map(s=>s+'.present').join(',')}{transform:translate(0,0);clip-path:inset(0)}`;
    css+=`${selector(id,'future','in')}{opacity:1;${effect==='push'?`transform:translate(${vector[0]},${vector[1]})`:`clip-path:${clip[0]}`}}`;
    css+=`${selector(id,'past','out')}{opacity:1;${effect==='push'?`transform:translate(${vector[2]},${vector[3]})`:`clip-path:${clip[1]}`}}`;
    css+=`${base.split(',').map(s=>'.reveal.overview '+s.replace('.reveal ','')).join(',')}{transform:none!important;clip-path:none!important}`;
  }
  css+='@media(prefers-reduced-motion:reduce){.reveal .slides section.sp-reveal-section{transition:none!important;transform:none!important;clip-path:none!important}.reveal .slides section.sp-reveal-section.past,.reveal .slides section.sp-reveal-section.future{opacity:0!important}}';
  replace('shared playback stylesheet','`+v15ExportCSS();}', '`+v15ExportCSS()+'+JSON.stringify(css)+';}');
  const frames=`      if(fx.startsWith('push-')){\n        const v=${JSON.stringify(vectors)}[fx.slice(5)],at=enter?[v[0],v[1]]:[v[2],v[3]];\n        const hidden={opacity:1,transform:'translate('+at.join(',')+')'},visible={opacity:1,transform:'translate(0,0)'};\n        return enter?[hidden,visible]:[visible,hidden];\n      }\n      if(fx.startsWith('wipe-')){\n        const c=${JSON.stringify(clips)}[fx.slice(5)],hidden={opacity:1,clipPath:c[enter?0:1]},visible={opacity:1,clipPath:'inset(0)'};\n        return enter?[hidden,visible]:[visible,hidden];\n      }\n`;
  replace('preview frames',"      if(fx==='zoom')return enter?", frames+"      if(fx==='zoom')return enter?");
  replace('preview matching easing',"const easing=to.morphEase||'cubic-bezier(.22,1,.36,1)'","const easing=to.transition==='morph'?(to.morphEase||'cubic-bezier(.22,1,.36,1)'):'cubic-bezier(.22,1,.36,1)'");
  return source;
}
