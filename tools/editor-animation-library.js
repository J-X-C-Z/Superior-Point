/** Integration patches only; keep the hash-checked reference editor intact. */
export function patchAnimationLibrary(source){
  const replace=(label,needle,value)=>{
    const count=source.split(needle).length-1;
    if(count!==1)throw new Error(`${label}: expected one exact source match, got ${count}`);
    source=source.replace(needle,()=>value);
  };
  const replaceBlock=(label,start,end,value)=>{
    for(const needle of [start,end]){
      const count=source.split(needle).length-1;
      if(count!==1)throw new Error(`${label}: expected one exact source boundary, got ${count}`);
    }
    const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
    if(to<from)throw new Error(`${label}: invalid source boundary order`);
    replace(label,source.slice(from,to),value);
  };
  replaceBlock('object effect catalog','  const V15_EFFECTS={','  const V15_KINDS=',`  const V15_EFFECTS={
    entrance:[['fade','淡入'],['float','上浮'],['zoom','放大进入'],['fade-left','左侧进入'],['fade-right','右侧进入'],['wipe','擦除出现'],['fade-up','顶部进入'],['fade-down','底部进入'],['wipe-left','擦除 · 从左'],['wipe-right','擦除 · 从右'],['wipe-top','擦除 · 从上'],['wipe-bottom','擦除 · 从下'],['appear','出现'],['split-h','劈裂 · 水平'],['split-v','劈裂 · 垂直'],['stretch-h','伸展 · 水平'],['stretch-v','伸展 · 垂直'],['bounce','弹跳进入'],['swivel','回旋进入'],['grow-turn','放大并旋转']],
    emphasis:[['pulse','脉冲'],['shake','轻摆'],['spin','旋转'],['highlight-red','朱红强调'],['grow','强调放大'],['blink','透明度闪烁'],['teeter','跷跷板']],
    exit:[['fade','淡出'],['float','下沉退出'],['zoom','缩小退出'],['fade-left','向左离开'],['fade-right','向右离开'],['fade-up','向上离开'],['fade-down','向下离开'],['wipe-left','擦除 · 向左'],['wipe-right','擦除 · 向右'],['wipe-top','擦除 · 向上'],['wipe-bottom','擦除 · 向下'],['disappear','消失'],['split-h','劈裂 · 水平'],['split-v','劈裂 · 垂直'],['stretch-h','收缩 · 水平'],['stretch-v','收缩 · 垂直'],['bounce','弹跳退出'],['swivel','回旋退出'],['grow-turn','缩小并旋转']]
  };
`);
  // Both frame players embed this body: exported HTML has no editor closure.
  const frames=`
    const b=Number.isFinite(base)?base:1,fx=f.effect;
    const wipe={wipe:'inset(0 100% 0 0)','wipe-left':'inset(0 100% 0 0)','wipe-right':'inset(0 0 0 100%)','wipe-top':'inset(0 0 100% 0)','wipe-bottom':'inset(100% 0 0 0)'};
    const split={'split-h':'inset(50% 0 50% 0)','split-v':'inset(0 50% 0 50%)'};
    if(f.kind==='entrance'){
      if(fx==='appear')return [{opacity:0,easing:'steps(1,start)'},{opacity:b}];
      if(split[fx])return [{opacity:b,clipPath:split[fx]},{opacity:b,clipPath:'inset(0 0 0 0)'}];
      if(fx==='stretch-h'||fx==='stretch-v')return [{opacity:b,scale:fx==='stretch-h'?'.01 1':'1 .01'},{opacity:b,scale:'1 1'}];
      if(fx==='bounce')return [{opacity:0,translate:'0 100px'},{opacity:b,translate:'0 0'},{opacity:b,translate:'0 -22px'},{opacity:b,translate:'0 8px'},{opacity:b,translate:'0 -3px'},{opacity:b,translate:'0 0'}];
      if(fx==='swivel')return [{opacity:0,rotate:'y 90deg'},{opacity:b,rotate:'y 0deg'}];
      if(fx==='grow-turn')return [{opacity:0,scale:.15,rotate:'-180deg'},{opacity:b,scale:1,rotate:'0deg'}];
      const initial={opacity:0,translate:'0 0',scale:1},end={opacity:b,translate:'0 0',scale:1};
      if(fx==='float')initial.translate='0 25px';
      if(fx==='zoom')initial.scale=.78;
      if(fx==='fade-left')initial.translate='-45px 0';
      if(fx==='fade-right')initial.translate='45px 0';
      if(fx==='fade-up')initial.translate='0 -45px';
      if(fx==='fade-down')initial.translate='0 45px';
      if(wipe[fx]){initial.clipPath=wipe[fx];end.clipPath='inset(0 0 0 0)';}
      return [initial,end];
    }
    if(f.kind==='exit'){
      if(fx==='disappear')return [{opacity:b,easing:'steps(1,start)'},{opacity:0}];
      if(split[fx])return [{opacity:b,clipPath:'inset(0 0 0 0)'},{opacity:b,clipPath:split[fx]}];
      if(fx==='stretch-h'||fx==='stretch-v')return [{opacity:b,scale:'1 1'},{opacity:0,scale:fx==='stretch-h'?'.01 1':'1 .01'}];
      if(fx==='bounce')return [{opacity:b,translate:'0 0'},{opacity:b,translate:'0 -3px'},{opacity:b,translate:'0 8px'},{opacity:b,translate:'0 -22px'},{opacity:b,translate:'0 0'},{opacity:0,translate:'0 100px'}];
      if(fx==='swivel')return [{opacity:b,rotate:'y 0deg'},{opacity:0,rotate:'y 90deg'}];
      if(fx==='grow-turn')return [{opacity:b,scale:1,rotate:'0deg'},{opacity:0,scale:.15,rotate:'180deg'}];
      const first={opacity:b,translate:'0 0',scale:1},last={opacity:0,translate:'0 0',scale:1};
      if(fx==='float')last.translate='0 25px';
      if(fx==='zoom')last.scale=.75;
      if(fx==='fade-left')last.translate='-42px 0';
      if(fx==='fade-right')last.translate='42px 0';
      if(fx==='fade-up')last.translate='0 -42px';
      if(fx==='fade-down')last.translate='0 42px';
      if(wipe[fx]){first.clipPath='inset(0 0 0 0)';last.clipPath=wipe[fx];}
      return [first,last];
    }
    if(fx==='teeter')return [{rotate:'0deg'},{rotate:'-8deg'},{rotate:'8deg'},{rotate:'-4deg'},{rotate:'4deg'},{rotate:'0deg'}];
    if(fx==='pulse')return [{scale:1},{scale:1.13},{scale:1}];
    if(fx==='grow')return [{scale:1},{scale:1.22},{scale:1}];
    if(fx==='shake')return [{translate:'0 0'},{translate:'-15px 0'},{translate:'15px 0'},{translate:'-8px 0'},{translate:'0 0'}];
    if(fx==='spin')return [{rotate:'0deg'},{rotate:'360deg'}];
    if(fx==='highlight-red')return [{filter:'none'},{filter:'drop-shadow(0 0 15px #d75c3c)'},{filter:'none'}];
    if(fx==='blink')return [{opacity:b},{opacity:b*.35},{opacity:b}];
    return [{opacity:b},{opacity:.5},{opacity:b}];
`;
  replaceBlock('editor object frames','  function v15Frames(f,base=1){','  function v15StopPreview(){',`  function v15Frames(f,base=1){${frames}  }\n`);
  replaceBlock('export object frames','      function styleFrames(m,alpha){','      function sync(sec){',`      function styleFrames(m,alpha){const f={kind:m.dataset.v15Kind,effect:m.dataset.v15Effect},base=alpha;${frames}      }\n`);
  replace('playback transparent opacity',"        const alpha=Number.parseFloat(el.style.opacity||'1')||1;",`        const parsedAlpha=Number.parseFloat(el.style.opacity||'1'),alpha=Number.isFinite(parsedAlpha)?parsedAlpha:1;`);
  replace('playback entrance delay fill',"fill:kind==='exit'?'forwards':'none'", "fill:kind==='exit'?'forwards':kind==='entrance'?'backwards':'none'");
  replace('playback completed exit cleanup',"if(kind==='exit')a.finished.then(()=>{if(m.classList.contains('visible'))el.classList.add('v15-exited');}).catch(()=>{});", "if(kind==='exit')a.finished.then(()=>{if(m.classList.contains('visible'))el.classList.add('v15-exited');a.cancel();}).catch(()=>{});");
  replace('single preview entrance delay fill',"easing:item.effect.easing,fill:'none'", "easing:item.effect.easing,fill:item.effect.kind==='entrance'?'backwards':'none'");
  replaceBlock('timeline CSS easing','  function v36MotionEase(f,raw){','  function v24Stop(){',`  function v36MotionEase(f,raw){
    const p=clamp(raw,0,1);if(p===0||p===1||f.easing==='linear')return p;
    const [x1,y1,x2,y2]=f.easing==='ease-in-out'?[.42,0,.58,1]:f.easing==='ease-out'?[0,0,.58,1]:[.22,1,.36,1];
    const cubic=(t,a,b)=>3*(1-t)*(1-t)*t*a+3*(1-t)*t*t*b+t*t*t;
    let low=0,high=1;for(let i=0;i<20;i++){const t=(low+high)/2;if(cubic(t,x1,x2)<p)low=t;else high=t;}
    return cubic((low+high)/2,y1,y2);
  }
`);
  replace('timeline scale and rotation state','let alpha=obj.opacity??1,scale=1,tx=0,ty=0,rot=0,filter=null,clip=null;',
    "let alpha=obj.opacity??1,scale=1,scaleY=1,tx=0,ty=0,rot=0,rotationAxis='',filter=null,clip=null;");
  replace('timeline two-axis scale output','node.style.scale=String(scale);',"node.style.scale=String(scale)+(scale===scaleY?'':' '+scaleY);");
  replace('timeline axis rotation output','node.style.rotate=\`\${rot.toFixed(2)}deg\`;','node.style.rotate=rotationAxis+\`\${rot.toFixed(2)}deg\`;');
  replaceBlock('timeline frame sampling',"        const raw=clamp((t-r.start)/Math.max(1,f.duration),0,1),p=reduce?1:v36MotionEase(f,raw);\n        if(f.kind==='entrance'){",'      node.style.opacity=String(clamp(alpha,0,1));',`        const raw=clamp((t-r.start)/Math.max(1,f.duration),0,1),p=reduce?1:v36MotionEase(f,raw);
        if(f.kind==='emphasis'&&raw>=1)continue;
        const frames=v15Frames(f,obj.opacity??1),phase=p*(frames.length-1),index=Math.min(Math.floor(phase),frames.length-2);
        const from=frames[index],to=frames[index+1],fraction=from.easing==='steps(1,start)'?1:phase-index;
        const mix=(a,b)=>a+(b-a)*fraction;
        const number=(frame,key,fallback)=>Number.parseFloat(frame[key]??fallback);
        if(from.opacity!==undefined||to.opacity!==undefined)alpha=mix(number(from,'opacity',obj.opacity??1),number(to,'opacity',obj.opacity??1));
        const pair=frame=>{const values=String(frame.scale??1).split(' ').map(Number);return [values[0],values[1]??values[0]];};
        const fromScale=pair(from),toScale=pair(to);scale*=mix(fromScale[0],toScale[0]);scaleY*=mix(fromScale[1],toScale[1]);
        const xy=frame=>String(frame.translate||'0 0').split(' ').map(value=>Number.parseFloat(value));
        const a=xy(from),b=xy(to);tx+=mix(a[0],b[0]);ty+=mix(a[1],b[1]);
        const rotation=frame=>String(frame.rotate||'0deg').split(' ');
        const fromRotation=rotation(from),toRotation=rotation(to);
        if(from.rotate!==undefined||to.rotate!==undefined)rotationAxis=fromRotation.length>1?fromRotation[0]+' ':toRotation.length>1?toRotation[0]+' ':'';
        rot+=mix(Number.parseFloat(fromRotation.at(-1)),Number.parseFloat(toRotation.at(-1)));
        if(from.clipPath||to.clipPath){
          const inset=frame=>(frame.clipPath||'inset(0 0 0 0)').match(/[\\d.]+/g).map(Number);
          const a=inset(from),b=inset(to);clip='inset('+a.map((value,i)=>mix(value,b[i]).toFixed(3)+'%').join(' ')+')';
        }
        if(from.filter!==undefined||to.filter!==undefined){
          const blur=frame=>Number.parseFloat(frame.filter?.match(/0 0 ([\\d.]+)px/)?.[1]||0);
          const radius=mix(blur(from),blur(to));filter=radius?'drop-shadow(0 0 '+radius.toFixed(2)+'px #d75c3c)':'none';
        }
      }
`);
  return source;
}
