/** Reproducible candidate-only patches. The v0.38 reference is never modified. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {revealJS,revealCSS} from '../vendor/reveal-bundle.js';
const root=new URL('../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');
let html=await read('vendor/editor-v038.source.html');
const sourceHash=createHash('sha256').update(html).digest('hex');
const expected=(await read('vendor/editor-v038.source.sha256')).trim().split(/\s+/)[0];
if(sourceHash!==expected)throw new Error('v0.38 source SHA-256 mismatch; candidate build refused');
const trustedSource=html;
function sourceBetween(start,end){const a=trustedSource.indexOf(start),b=trustedSource.indexOf(end,a+start.length);if(a<0||b<0)throw Error('Trusted playback boundary missing');return trustedSource.slice(a,b).trim();}
const legacyPlaybackBootstrap=sourceBetween('  function v15PlaybackBootstrap(){','  v15PlaybackBootstrap();')+'\n'+sourceBetween('  function v24OfflineExportBootstrap(width,height){','  function v24OfflineExportCSS()');
new Script(legacyPlaybackBootstrap,{filename:'trusted-v038-playback.js'});
await writeFile(new URL('vendor/editor-v038-playback.js',root),'// Generated from SHA-256 '+sourceHash+'; trusted source, not iframe output.\nexport const legacyPlaybackBootstrap='+JSON.stringify(legacyPlaybackBootstrap)+';\n');
const patches=[];
function replace(label,needle,replacement){
 const hits=html.split(needle).length-1;if(hits!==1)throw new Error(`${label}: expected one exact source match, got ${hits}`);
 html=html.replace(needle,()=>replacement);patches.push(label);
}
const csp="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
const gate=`window.__SPEmbeddedGate={locked:true};for(const kind of ['click','dblclick','pointerdown','pointermove','pointerup','mousedown','mouseup','keydown','beforeinput','input','change','paste','cut','drop','dragstart'])window.addEventListener(kind,e=>{if(window.__SPEmbeddedGate.locked){e.preventDefault();e.stopImmediatePropagation();}},true);`;
const escapeScript=s=>s.replace(/<\/script/gi,'<\\/script');
replace('embedded CSP + early interaction gate','<head>\n<meta charset="utf-8">',`<head>\n<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><script>${gate}</script><style id="sp-candidate-reveal-css">${revealCSS}</style><script id="sp-candidate-reveal-code">${escapeScript(revealJS)}</script>`);
// Editor UI preferences remain local to this embedded session, not host origin storage.
replace('isolated preference storage',"  const STORAGE_KEY = 'superiorpoint.noema.reveal.v2';",`  const localStorage=(()=>{const data=new Map();return {getItem:k=>data.get(String(k))??null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k))};})();\n  const STORAGE_KEY = 'superiorpoint.noema.reveal.v2';`);
replace('parent-only commits','  function commit(silent=false) {','  function commit(silent=false) { return spBridgeCommit(silent);\n /* candidate: original history below is unreachable */');
replace('parent-only autosave','  function scheduleAutosave(){','  function scheduleAutosave(){return spBridgeCommit(true); /* parent owns persistence */');
replace('parent-only undo',"  function undo(){if(undoPosition>0)sp30RestoreHistoryState(undoPosition-1);}","  function undo(){return spBridgeCommand('undo');}");
replace('parent-only redo',"  function redo(){if(undoPosition<undoStates.length-1)sp30RestoreHistoryState(undoPosition+1);}","  function redo(){return spBridgeCommand('redo');}");
replace('disable old history jump','  function v11JumpHistory(i){','  function v11JumpHistory(i){return spBridgeUnavailable();');
replace('disable old history browser','  function v11HistoryDialog(){','  function v11HistoryDialog(){return spBridgeUnavailable();');
replace('disable project IndexedDB',"  function openProjectDB(){return new Promise", "  function openProjectDB(){return Promise.reject(Error('候选编辑器的项目存储由工作台管理')); /* disabled legacy DB */ return new Promise");
replace('disable old explicit save','  async function v10StoreCurrent(showMessage=false){','  async function v10StoreCurrent(showMessage=false){return false;');
replace('disable old file hub',"  function v10ShowHub(view='recent'){","  function v10ShowHub(view='recent'){return spBridgeUnavailable();");
replace('route project import','  async function handleFile(file){if(!file)return;','  async function handleFile(file){if(!file)return;return spBridgeCommand(\'import\',{file});');
replace('route save button','  function saveJSON(){','  function saveJSON(){return spBridgeCommand(\'save\');');
replace('save tooltip describes workspace persistence','title="将项目保存为可编辑 JSON (Ctrl / ⌘ + S)"','title="保存到上方工作台 (Ctrl / ⌘ + S)；下载 JSON 备份请用上方按钮"');
replace('header save label','<span data-icon="save"></span>保存</button>','<span data-icon="save"></span>保存到工作台</button>');
replace('mobile save label','data-action="save-json"><b>⇩</b>保存项目','data-action="save-json"><b>⇩</b>保存到工作台');
replace('command save label',"['保存项目 JSON','save-json','文件']","['保存到工作台','save-json','文件']");
replace('ribbon save label',"tool('下载 JSON','download','save-json')","tool('保存到工作台','save','save-json')");
replace('disabled Hub save label',"v10Action('下载项目 JSON','save-json',true,'推荐作为可靠备份')","v10Action('保存到工作台','save-json',true,'JSON 备份请使用上方工作台按钮')");

replace('route export button','  function exportRevealHTML(){','  function exportRevealHTML(){return spBridgeCommand(\'export\',{format:\'html\'});');
replace('block old Hub action paths','  function performAction(action,value){',`  function performAction(action,value){\n    if(spBridgeAction(action,value))return;`);
replace('parent status text',"  function markSaved(){$('#save-status').textContent='已缓存到本地 · 建议定期下载 JSON';$('#save-indicator').classList.remove('unsaved');}","  function markSaved(){spBridgeStatus();}");
// Parent tracks authoritative undo availability; both actions are safe even at history bounds.
html=html.replaceAll('disabled:undoPosition<=0','disabled:spBridgeReadOnly||!spBridgeHistory.canUndo').replaceAll('disabled:undoPosition>=undoStates.length-1','disabled:spBridgeReadOnly||!spBridgeHistory.canRedo');
patches.push('parent undo controls');
// Read/decode images off-model, then commit only to their original writable session.
replace('guard async picture insertion',sourceBetween('  async function addPicture(file,at=null,options={}){','  // Export editable PowerPoint.'),'async function addPicture(file,at=null,options={}){return spBridgeInsertPicture(file,at,options); }');
replace('guard async picture replacement',sourceBetween('  async function replacePicture(file){','  async function addPicture(file,at=null,options={}){'),'async function replacePicture(file){return spBridgeReplacePicture(file); }');
replace('stage picture batch before one commit',sourceBetween("    $('#picture-upload').addEventListener('change',async e=>{","    $('#media-upload').addEventListener('change',"),"$('#picture-upload').addEventListener('change',e=>{const files=[...(e.target.files||[])].slice(0,6);e.target.value='';spBridgeInsertPictures(files);});");
// Let the bridge end the timeline gesture when its writer session ends.
replace('bridge-owned timeline gesture','    let v15Dragging=null;','');
const bridge=await read('tools/editor-v038-bridge.inc.js');
const pictures=await read('tools/editor-v038-image.inc.js');
// Reuse the canonical raster byte inspector rather than a divergent iframe copy.
const rasterChecks=`const spBridgeRasterAssets=(()=>{${(await read('io/image-assets.js')).replace(/^export /gm,'')}\nreturn {inspectRasterDataURL,IMAGE_LIMITS};})();`;
new Script(rasterChecks,{filename:'candidate-raster-checks.js'});
new Script(pictures,{filename:'candidate-picture-bridge.js'});
replace('explicit parent initialization',"  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();",`${bridge}\n${rasterChecks}\n${pictures}\n  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',spBridgeBoot,{once:true});else spBridgeBoot();`);
html=html.replaceAll('REVEAL.JS 6','REVEAL.JS · OFFLINE').replaceAll('Reveal.js 6 演示引擎','Reveal.js 离线候选演示引擎');
replace('candidate visible identity','<title>SuperiorPoint v0.37 — 放映与录制精修 · Noema</title>','<title>SuperiorPoint v0.38 · 集成候选编辑器</title>');
html=html.replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>\s*<\/script>/gi,'');
await writeFile(new URL('vendor/editor-v038-candidate.js',root),`// Generated by tools/build-editor-candidate.js. Do not edit.\n// Source SHA-256: ${sourceHash}\nexport const editorCandidateHTML=${JSON.stringify(html)};\nexport const editorCandidateSourceSHA256=${JSON.stringify(sourceHash)};\n`);
await writeFile(new URL('vendor/editor-v038-candidate.manifest.json',root),JSON.stringify({source:'editor-v038.source.html',sourceSHA256:sourceHash,candidateSHA256:createHash('sha256').update(html).digest('hex'),patches,mode:'integration-candidate-not-frozen',reveal:'bundled vendor/reveal-bundle.js'},null,2)+'\n');
console.log(`Built candidate editor (${Buffer.byteLength(html)} bytes); ${patches.length} explicit patches; source ${sourceHash}`);
