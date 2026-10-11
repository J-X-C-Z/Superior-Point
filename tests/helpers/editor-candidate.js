import {JSDOM,VirtualConsole} from 'jsdom';
import {editorCandidateHTML} from '../../vendor/editor-integrated.js';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function candidateHarness(project,{readOnly=false,html=editorCandidateHTML}={}){
 const channel='test-candidate-channel',messages=[],errors=[];
 let reads=0,writes=0,opens=0,window;
 const parent={postMessage(message){messages.push(message);}};
 const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>{if(!String(error.message).includes('HTMLCanvasElement'))errors.push(error);});
 const dom=new JSDOM(html.replace('__SP_BRIDGE_CHANNEL__',channel),{
  url:'https://candidate.invalid/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,
  beforeParse(w){window=w;Object.defineProperty(w,'parent',{value:parent});
   Object.defineProperty(w,'localStorage',{get(){reads++;return{getItem(){reads++;return null;},setItem(){writes++;}};}});
   w.indexedDB={open(){opens++;throw Error('Legacy database must not open');}};
   w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
   w.CSS??={};w.CSS.escape=s=>String(s).replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c);
   w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
   w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
   w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLElement.prototype.scrollBy=function(){};
   w.HTMLElement.prototype.getAnimations=function(){return[];};
   w.HTMLCanvasElement.prototype.getContext=function(){return {measureText:s=>({width:String(s).length*8}),setTransform(){},clearRect(){},fillRect(){},save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(){},translate(){},scale(){},rect(){},clip(){},drawImage(){},setLineDash(){},quadraticCurveTo(){},closePath(){}};};
  }
 });
 const send=(type,data={})=>window.dispatchEvent(new window.MessageEvent('message',{source:parent,data:{spCandidate:1,channel,type,...data}}));
 const until=async predicate=>{for(let i=0;i<150;i++){if(predicate())return;await pause(10);}throw Error('Candidate wait timeout: '+errors.map(e=>e.message).join('; '));};
 await until(()=>messages.some(m=>m.type==='ready'));
 send('initialize',{project,revision:0,readOnly,epoch:1,history:{canUndo:false,canRedo:false},requestId:1});
 await until(()=>messages.some(m=>m.type==='response'&&m.requestId===1));
 const init=messages.find(m=>m.type==='response'&&m.requestId===1);if(init.error){dom.window.close();throw Error(init.error);}
 return {dom,window,messages,errors,send,until,pause,storage:()=>({reads,writes,opens}),close:()=>dom.window.close()};
}
