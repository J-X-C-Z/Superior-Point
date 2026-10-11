import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {patchAnimationLibrary} from '../tools/editor-animation-library.js';

const original=readFileSync(new URL('../vendor/editor-v039.source.html',import.meta.url),'utf8');
const source=patchAnimationLibrary(original);
function between(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return text.slice(a,b);}
const catalog=runInNewContext(between(source,'  const V15_EFFECTS={','  const V15_KINDS=')+'V15_EFFECTS;');
const editor=runInNewContext(between(source,'  function v15Frames(f,base=1){','  function v15StopPreview(){')+'v15Frames;');
const playback=runInNewContext(between(source,'      function styleFrames(m,alpha){','      function sync(sec){')+'styleFrames;');
const plain=value=>JSON.parse(JSON.stringify(value));
function sample(kind,effect,time,reduce=false,tracks=null){
  const f={kind,effect,duration:1000,easing:'linear'},obj={id:'o',opacity:.8};
  const node={dataset:{id:'o'},style:{opacity:'.8',translate:'',scale:'',rotate:'',filter:'',clipPath:''}};
  const context={clamp:(n,min,max)=>Math.max(min,Math.min(max,n)),v15StopPreview(){},v36PreviewFrame:0,
    cancelAnimationFrame(){},v24Schedule:()=>({max:3000,rows:tracks?tracks.map(track=>({o:obj,effect:{duration:1000,easing:'linear',...track.effect},start:track.start})):[{o:obj,effect:f,start:0}]}),
    v36MotionStyles:new WeakMap(),v36StyleKeys:['opacity','translate','scale','rotate','filter','clipPath'],
    curSlide:()=>({objects:[obj]}),matchMedia:()=>({matches:reduce}),$$:sel=>sel==='#stage-mount .slide-object'?[node]:[],$:()=>null};
  runInNewContext(between(source,'  function v36MotionEase(f,raw){','  function v24Stop(){')+
    between(source,'  function v15Frames(f,base=1){','  function v15StopPreview(){')+
    between(source,'  function v24Seek(time,continuous=false){','  function v24ChangeZoom(v){')+`v24Seek(${time});`,context);
  return node.style;
}

test('catalog accepts common directions and blink while retaining every old effect and validation',()=>{
  const old=runInNewContext(between(original,'  const V15_EFFECTS={','  const V15_KINDS=')+'V15_EFFECTS;');
  for(const kind of Object.keys(old))for(const [id,label] of old[kind])assert.ok(catalog[kind].some(([v,t])=>v===id&&t===label));
  for(const kind of ['entrance','exit'])for(const id of ['fade-up','fade-down','wipe-left','wipe-right','wipe-top','wipe-bottom'])assert.ok(catalog[kind].some(([v])=>v===id));
  assert.ok(catalog.emphasis.some(([v])=>v==='blink'));
  const validate=runInNewContext(between(source,'  const V15_EFFECTS={','  let v15AddKind=')+
    between(source,'  function v15ValidateEffect(f,i=0){','  function v15Effects(o){')+'v15ValidateEffect;',
    {clamp:(n,min,max)=>Math.max(min,Math.min(max,n)),uuid:()=> 'generated'});
  const oldEffect={id:'old-effect',kind:'entrance',effect:'wipe',trigger:'after',step:3,delay:70,duration:620,easing:'linear'};
  assert.deepEqual(plain(validate(oldEffect)),oldEffect);assert.deepEqual(plain(oldEffect),oldEffect);
  assert.equal(validate({kind:'exit',effect:'wipe-top'}).effect,'wipe-top');
  assert.equal(validate({kind:'evil',effect:'unsafe'}).effect,'fade');
  assert.equal(validate({kind:'emphasis',effect:'blink',duration:99999}).duration,6000);
});

test('editor and self-contained exported player use identical frames for every catalog effect',()=>{
  for(const kind of Object.keys(catalog))for(const [effect] of catalog[kind]){
    const actual=playback({dataset:{v15Kind:kind,v15Effect:effect}},.8);
    assert.deepEqual(plain(actual),plain(editor({kind,effect},.8)),`${kind}/${effect}`);
  }
  assert.equal(editor({kind:'emphasis',effect:'shake'}).length,5);
  assert.deepEqual(plain(editor({kind:'emphasis',effect:'blink'},.8)),[{opacity:.8},{opacity:.8*.35},{opacity:.8}]);
});

test('timeline samples the same directional, opacity and shake frames, and reduced motion settles',()=>{
  for(const kind of ['entrance','exit']){
    for(const [effect] of catalog[kind].filter(([id])=>['fade','float','zoom','fade-left','fade-right','wipe','fade-up','fade-down','wipe-left','wipe-right','wipe-top','wipe-bottom'].includes(id))){
      const frames=editor({kind,effect},.8),middle=sample(kind,effect,500);
      assert.equal(Number(middle.opacity),.4,`${kind}/${effect} opacity`);
      const first=frames[0],last=frames.at(-1);
      if(first.clipPath||last.clipPath){
        const a=first.clipPath.match(/[\d.]+/g).map(Number),b=last.clipPath.match(/[\d.]+/g).map(Number);
        assert.equal(middle.clipPath,'inset('+a.map((x,i)=>((x+b[i])/2).toFixed(3)+'%').join(' ')+')');
      }
      const from=(first.translate||'0 0').split(' ').map(parseFloat),to=(last.translate||'0 0').split(' ').map(parseFloat);
      assert.equal(middle.translate,`${((from[0]+to[0])/2).toFixed(2)}px ${((from[1]+to[1])/2).toFixed(2)}px`);
      const settled=sample(kind,effect,500,true);
      assert.equal(Number(settled.opacity),kind==='entrance'?.8:0);
    }
  }
  assert.ok(Math.abs(Number(sample('emphasis','blink',500).opacity)-.28)<1e-12);
  assert.equal(Number(sample('emphasis','blink',1000).opacity),.8);
  for(const [time,x] of [[0,0],[250,-15],[500,15],[750,-8],[1000,0]])assert.equal(sample('emphasis','shake',time).translate,`${x.toFixed(2)}px 0.00px`);
  assert.equal(sample('emphasis','highlight-red',500).filter,'drop-shadow(0 0 15.00px #d75c3c)');
});

test('PowerPoint-inspired additions have distinct frames and their timeline samples match',()=>{
  assert.equal(catalog.entrance.length,20);assert.equal(catalog.exit.length,19);assert.equal(catalog.emphasis.length,7);
  for(const kind of ['entrance','exit'])for(const effect of ['split-h','split-v','stretch-h','stretch-v','bounce','swivel','grow-turn']){
    const frames=editor({kind,effect},.8);
    for(const time of [0,125,250,500,800,1000]){
      const phase=time/1000*(frames.length-1),i=Math.min(Math.floor(phase),frames.length-2),p=phase-i,a=frames[i],b=frames[i+1];
      const mix=(x,y)=>x+(y-x)*p,style=sample(kind,effect,time);
      assert.ok(Math.abs(Number(style.opacity)-mix(a.opacity??.8,b.opacity??.8))<1e-9,`${kind}/${effect}/${time} opacity`);
      const xy=frame=>String(frame.translate||'0 0').split(' ').map(parseFloat),x=xy(a),y=xy(b);
      assert.equal(style.translate,`${mix(x[0],y[0]).toFixed(2)}px ${mix(x[1],y[1]).toFixed(2)}px`);
      const scale=frame=>{const v=String(frame.scale??1).split(' ').map(Number);return [v[0],v[1]??v[0]];};
      const sa=scale(a),sb=scale(b),expected=[mix(sa[0],sb[0]),mix(sa[1],sb[1])];
      const actual=style.scale.split(' ').map(Number);assert.ok(Math.abs(actual[0]-expected[0])<1e-9);assert.ok(Math.abs((actual[1]??actual[0])-expected[1])<1e-9);
      if(a.clipPath){const ca=a.clipPath.match(/[\d.]+/g).map(Number),cb=b.clipPath.match(/[\d.]+/g).map(Number);
        assert.equal(style.clipPath,'inset('+ca.map((v,n)=>mix(v,cb[n]).toFixed(3)+'%').join(' ')+')');}
      if(a.rotate){const ra=a.rotate.split(' '),rb=b.rotate.split(' '),axis=ra.length>1?ra[0]+' ':'';
        assert.equal(style.rotate,axis+mix(parseFloat(ra.at(-1)),parseFloat(rb.at(-1))).toFixed(2)+'deg');}
    }
    const reduced=sample(kind,effect,250,true),last=frames.at(-1);
    assert.equal(Number(reduced.opacity),last.opacity??.8);
  }
  for(const time of [0,1,250,999,1000]){
    assert.equal(Number(sample('entrance','appear',time).opacity),.8);
    assert.equal(Number(sample('exit','disappear',time).opacity),0);
  }
  assert.equal(editor({kind:'entrance',effect:'appear'})[0].easing,'steps(1,start)');
  assert.equal(editor({kind:'exit',effect:'disappear'})[0].easing,'steps(1,start)');
  for(const [time,angle] of [[0,0],[200,-8],[400,8],[600,-4],[800,4],[1000,0]])assert.equal(sample('emphasis','teeter',time).rotate,angle.toFixed(2)+'deg');
  assert.notDeepEqual(plain(editor({kind:'entrance',effect:'split-h'})),plain(editor({kind:'entrance',effect:'split-v'})));
  assert.notDeepEqual(plain(editor({kind:'entrance',effect:'stretch-h'})),plain(editor({kind:'entrance',effect:'zoom'})));
});

test('rotation axis follows the current rotating track after a completed swivel',()=>{
  const swivel={effect:{kind:'entrance',effect:'swivel'},start:0};
  for(const [effect,angle] of [['spin',72],['teeter',-8]]){
    const tracks=[swivel,{effect:{kind:'emphasis',effect},start:1000}];
    const style=sample('entrance','swivel',1200,false,tracks);
    assert.equal(style.rotate,angle.toFixed(2)+'deg',effect+' rotates around Z');
  }
  const noRotate=[swivel,{effect:{kind:'entrance',effect:'fade'},start:1000}];
  assert.equal(sample('entrance','swivel',1200,false,noRotate).rotate,'y 0.00deg','non-rotating track does not change axis');
});

test('transparent objects stay transparent and delayed entrances keep their initial frame',()=>{
  for(const kind of ['entrance','exit']){
    for(const [effect] of catalog[kind]){
      assert.ok(editor({kind,effect},0).every(frame=>frame.opacity===0));
      assert.ok(playback({dataset:{v15Kind:kind,v15Effect:effect}},0).every(frame=>frame.opacity===0));
    }
  }
  const alpha=between(source,"        const parsedAlpha=",'        if(!reduce()');
  assert.equal(runInNewContext(alpha+'alpha;', {el:{style:{opacity:'0'}}}),0);
  assert.equal(runInNewContext(alpha+'alpha;', {el:{style:{opacity:'invalid'}}}),1);
  const fill=source.match(/fill:(kind==='exit'\?'forwards':kind==='entrance'\?'backwards':'none')/)[1];
  assert.equal(runInNewContext(fill,{kind:'entrance'}),'backwards');
  assert.equal(runInNewContext(fill,{kind:'exit'}),'forwards');
  assert.equal(runInNewContext(fill,{kind:'emphasis'}),'none');
  assert.ok(source.includes("fill:item.effect.kind==='entrance'?'backwards':'none'"));
});

test('real playback handler releases completed exit animation before a later entrance',async()=>{
  const classes=new Set(),calls=[],handlers={},animations=[];
  const el={dataset:{v15ObjectId:'o'},style:{opacity:'0'},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)},
    animate:(frames,options)=>{calls.push({frames:plain(frames),options:plain(options)});const animation={finished:Promise.resolve(),cancelled:false,cancel(){this.cancelled=true;}};animations.push(animation);return animation;}};
  const marker={dataset:{v15ObjectId:'o',v15Kind:'exit',v15Effect:'fade',fragmentIndex:'0',v15Delay:'200',v15Duration:'400'},classList:{contains:()=>true},closest:()=>sec};
  const sec={querySelectorAll:selector=>selector==='.v15-motion-marker'?[marker]:[el]};
  const reveal={getCurrentSlide:()=>sec,on:(event,handler)=>handlers[event]=handler};
  const context={window:{matchMedia:()=>({matches:false})},clearTimeout(){},setTimeout(){}};
  runInNewContext(between(source,'  function v15PlaybackBootstrap(){','  v15PlaybackBootstrap();')+'v15PlaybackBootstrap();',context);
  context.window.SuperiorPointMotion.attach(reveal);
  handlers.fragmentshown({fragment:marker});await Promise.resolve();
  assert.equal(calls[0].options.fill,'forwards');assert.equal(calls[0].frames[0].opacity,0);
  assert.equal(animations[0].cancelled,true);assert.equal(classes.has('v15-exited'),true);
  marker.dataset.v15Kind='entrance';handlers.fragmentshown({fragment:marker});
  assert.equal(calls[1].options.fill,'backwards');assert.equal(calls[1].options.delay,200);
  assert.equal(calls[1].frames.at(-1).opacity,0);assert.equal(classes.has('v15-exited'),false);
});

test('timeline easing follows CSS cubic-bezier rather than a polynomial approximation',()=>{
  const ease=runInNewContext(between(source,'  function v36MotionEase(f,raw){','  function v24Stop(){')+'v36MotionEase;',
    {clamp:(n,min,max)=>Math.max(min,Math.min(max,n))});
  for(const easing of ['linear','ease-in-out','ease-out','cubic-bezier(.22,1,.36,1)']){
    assert.equal(ease({easing},0),0);assert.equal(ease({easing},1),1);
    let prior=0;for(let i=1;i<=10;i++){const value=ease({easing},i/10);assert.ok(value>=prior&&value<=1);prior=value;}
  }
  assert.equal(ease({easing:'linear'},.5),.5);
  assert.ok(Math.abs(ease({easing:'ease-in-out'},.5)-.5)<1e-5);
  assert.ok(Math.abs(ease({easing:'ease-out'},.5)-.684643)<1e-5);
  // Point on the default curve at Bezier parameter t=.5: x=.3425, y=.875.
  assert.ok(Math.abs(ease({easing:'cubic-bezier(.22,1,.36,1)'},.3425)-.875)<1e-5);
});

test('source patch fails closed on missing, duplicate or repeated application',()=>{
  assert.throws(()=>patchAnimationLibrary(original.replace('  const V15_EFFECTS={','  const MOVED_EFFECTS={')),/expected one exact source boundary/);
  assert.throws(()=>patchAnimationLibrary(original+'\n  const V15_EFFECTS={'),/got 2/);
  assert.throws(()=>patchAnimationLibrary(source),/expected one exact source (boundary|match)/);
});
