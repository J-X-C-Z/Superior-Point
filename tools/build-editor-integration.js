/** Reproducible integration-only patches. The v0.39 reference is never modified. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {revealJS,revealCSS} from '../vendor/reveal-bundle.js';
import {patchAnimationLibrary} from './editor-animation-library.js';
import {patchTransitionLibrary} from './editor-transition-library.js';
import {patchEffectGallery} from './editor-effect-gallery.js';
const root=new URL('../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');
let html=await read('vendor/editor-v039.source.html');
const sourceHash=createHash('sha256').update(html).digest('hex');
const expected=(await read('vendor/editor-v039.source.sha256')).trim().split(/\s+/)[0];
if(sourceHash!==expected)throw new Error('v0.39 source SHA-256 mismatch; candidate build refused');
// Both embedded editing and trusted exports must use the same expanded effects.
html=patchTransitionLibrary(patchAnimationLibrary(html));
const trustedSource=html;
function sourceBetween(start,end){const a=trustedSource.indexOf(start),b=trustedSource.indexOf(end,a+start.length);if(a<0||b<0)throw Error('Trusted playback boundary missing');return trustedSource.slice(a,b).trim();}
const legacyPlaybackBootstrap=sourceBetween('  function v15PlaybackBootstrap(){','  v15PlaybackBootstrap();')+'\n'+sourceBetween('  function v24OfflineExportBootstrap(width,height){','  function v24OfflineExportCSS()');
new Script(legacyPlaybackBootstrap,{filename:'trusted-v039-playback.js'});
const trustedStyleFunctions=['revealStyleSheet','v15ExportCSS','v24OfflineExportCSS'].map(name=>{
 const line=trustedSource.split('\n').find(line=>line.startsWith('  function '+name+'(){'));
 if(!line)throw Error('Trusted stylesheet boundary missing: '+name);
 return line.trim();
}).join('\n');
const legacyPresentationCSS='export function legacyPresentationCSS(width,height){const deck={width,height};\n'+trustedStyleFunctions+'\nreturn revealStyleSheet()+v24OfflineExportCSS();}';
new Script(legacyPresentationCSS.replace('export function','function'),{filename:'trusted-v039-styles.js'});
await writeFile(new URL('vendor/editor-integrated-playback.js',root),'// Generated from SHA-256 '+sourceHash+'; trusted source, not iframe output.\nexport const legacyPlaybackBootstrap='+JSON.stringify(legacyPlaybackBootstrap)+';\n'+legacyPresentationCSS+'\n');
const patches=['shared object animation library','directional page transition library'];
function replace(label,needle,replacement){
 const hits=html.split(needle).length-1;if(hits!==1)throw new Error(`${label}: expected one exact source match, got ${hits}`);
 html=html.replace(needle,()=>replacement);patches.push(label);
}
const csp="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
const gate=`window.__SPEmbeddedGate={locked:true};for(const kind of ['click','dblclick','pointerdown','pointerup','mousedown','mouseup','keydown','beforeinput','input','change','paste','cut','drop','dragstart'])window.addEventListener(kind,e=>{if(window.__SPEmbeddedGate.locked){e.preventDefault();e.stopImmediatePropagation();}},true);`;
const escapeScript=s=>s.replace(/<\/script/gi,'<\\/script');
replace('embedded CSP + early interaction gate','<head>\n<meta charset="utf-8">',`<head>\n<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><script>${gate}</script><style id="sp-candidate-reveal-css">${revealCSS}</style><script id="sp-candidate-reveal-code">${escapeScript(revealJS)}</script>`);
// Editor UI preferences remain local to this embedded session, not host origin storage.
replace('isolated preference storage',"  const STORAGE_KEY = 'superiorpoint.noema.reveal.v2';",`  const localStorage=(()=>{const data=new Map();return {getItem:k=>data.get(String(k))??null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k))};})();\n  const STORAGE_KEY = 'superiorpoint.noema.reveal.v2';`);
replace('parent-only commits','  function commit(silent=false) {','  function commit(silent=false) { return spBridgeCommit(silent);\n /* candidate: original history below is unreachable */');
replace('parent-only autosave','  function scheduleAutosave(){','  function scheduleAutosave(){return spBridgeScheduleAutosave(); /* parent owns persistence; preserve IME */');
replace('parent-only undo',"  function undo(){if(undoPosition>0)sp30RestoreHistoryState(undoPosition-1);}","  function undo(){return spBridgeCommand('undo');}");
replace('parent-only redo',"  function redo(){if(undoPosition<undoStates.length-1)sp30RestoreHistoryState(undoPosition+1);}","  function redo(){return spBridgeCommand('redo');}");
replace('disable old history jump','  function v11JumpHistory(i){','  function v11JumpHistory(i){return spBridgeUnavailable();');
replace('disable old history browser','  function v11HistoryDialog(){','  function v11HistoryDialog(){return spBridgeUnavailable();');
replace('disable project IndexedDB',"  function openProjectDB(){return new Promise", "  function openProjectDB(){return Promise.reject(Error('候选编辑器的项目存储由工作台管理')); /* disabled legacy DB */ return new Promise");
replace('disable old explicit save','  async function v10StoreCurrent(showMessage=false){','  async function v10StoreCurrent(showMessage=false){return false;');
replace('disable old file hub',"  function v10ShowHub(view='recent'){","  function v10ShowHub(view='recent'){return spBridgeUnavailable();");
replace('route project import','  async function handleFile(file){','  async function handleFile(file){if(!file)return;return spBridgeCommand(\'import\',{file});');
replace('route save button','  function saveJSON(){','  function saveJSON(){return spBridgeCommand(\'save\');');
replace('save tooltip describes workspace persistence','title="将项目保存为可编辑 JSON (Ctrl / ⌘ + S)"','title="保存到上方工作台 (Ctrl / ⌘ + S)；下载 JSON 备份请用上方按钮"');
replace('header save label','<span data-icon="save"></span>保存</button>','<span data-icon="save"></span>保存到工作台</button>');
replace('mobile save label','data-action="save-json"><b>⇩</b>保存项目','data-action="save-json"><b>⇩</b>保存到工作台');
replace('command save label',"['保存项目 JSON','save-json','文件']","['保存到工作台','save-json','文件']");
replace('ribbon save label',"tool('下载 JSON','download','save-json')","tool('保存到工作台','save','save-json')");
replace('disabled Hub save label',"v10Action('下载项目 JSON','save-json',true,'推荐作为可靠备份')","v10Action('保存到工作台','save-json',true,'JSON 备份请使用上方工作台按钮')");

replace('route export button','  function exportRevealHTML(){','  function exportRevealHTML(){return spBridgeCommand(\'export\',{format:\'html\'});');
replace('route v039 editable HTML export','  function sp39ExportEditable(){',"  function sp39ExportEditable(){return spBridgeExportHTML();");
replace('route HTML export through privacy-labelled parent flow',"  function exportRevealHTML(){return spBridgeCommand('export',{format:'html'});",'  function exportRevealHTML(){return spBridgeExportHTML();');
replace('disable independent document replacement entry',"  async function v10Create(kind){","  async function v10Create(kind){return spBridgeCommand('home');");
replace('parent-owned quick-access history',"b.disabled=b.dataset.action==='undo'?undoPosition<=0:undoPosition>=undoStates.length-1;","b.disabled=spBridgeReadOnly||(b.dataset.action==='undo'?!spBridgeHistory.canUndo:!spBridgeHistory.canRedo);");
replace('visibility flush uses parent bridge',"document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){sp39MirrorEditor();v24Stop();if(deck)v10StoreCurrent(false);}});","document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){v24Stop();if(deck)spBridgeFlush().catch(error=>toast(error.message,true));}});");
replace('bundled Reveal only',sourceBetween('  async function ensureReveal(){','  function activeRevealIndex()'),"  async function ensureReveal(){if(typeof window.Reveal==='function')return window.Reveal;throw Error('内嵌 Reveal 引擎不可用；请重新打开完整集成文件');}\n");
replace('new-project guide uses workspace','从「新建」创建空白文稿。插入文字、形状或拖入本地图片；双击文字直接修改。','从上方工作台创建空白文稿。插入文字、形状或拖入本地图片；双击文字直接修改。');
replace('guide describes complete export privacy','Ctrl / ⌘+S 下载完整 JSON；「更多」可导出带编辑器的 HTML。演示 HTML 默认剔除备注、批注及历史。','Ctrl / ⌘+S 保存到工作台；请用上方按钮下载 JSON 备份或完整可重编辑 HTML。备份 HTML 含备注、批注及历史；观众分享版请在上方工作台另行导出。');
replace('guide persistence and offline engine truth','本工具不联网同步文稿。浏览器缓存可能受权限与清理影响，重要内容请下载 JSON。PPTX 是有限转换格式；高级 Reveal 动效依赖可用的引擎资源。','本工具不联网同步文稿。保存状态以上方工作台为准，重要内容请下载 JSON 备份。PPTX 是有限转换格式；Reveal 引擎已内嵌离线包。');
replace('built-in demo export privacy note','演示 HTML 默认不含备注、批注和历史；可编辑 HTML 含完整项目。','备份 HTML 含完整项目、备注、批注及历史；观众分享版在上方工作台另行导出，仅供放映。');
replace('built-in demo export explanation','可编辑 HTML  ·  编辑器与文稿一起带走\\n演示 HTML  ·  给观众的干净版本','备份 HTML  ·  完整数据可重新编辑\\n观众分享版  ·  上方工作台另行导出');
replace('editable HTML menu label','可编辑 HTML <small>含完整项目与备注</small>','完整可重编辑 HTML <small>含备注、批注及历史</small>');
replace('HTML export tooltip states privacy','title="导出基于 reveal.js 的 HTML"','title="导出完整可重编辑 HTML；包含备注、批注及历史，不是观众脱敏版"');
replace('block old Hub action paths','  function performAction(action,value){',`  function performAction(action,value){\n    if(spBridgeAction(action,value))return;`);
replace('parent status text',sourceBetween('  function markSaved(){','  function toast('),"  function markSaved(){spBridgeStatus();}\n");
// Parent tracks authoritative undo availability; both actions are safe even at history bounds.
html=html.replaceAll('disabled:undoPosition<=0','disabled:spBridgeReadOnly||!spBridgeHistory.canUndo').replaceAll('disabled:undoPosition>=undoStates.length-1','disabled:spBridgeReadOnly||!spBridgeHistory.canRedo');
patches.push('parent undo controls');
// Read/decode images off-model, then commit only to their original writable session.
replace('guard async picture insertion',sourceBetween('  async function addPicture(file,at=null,options={}){','  // Export editable PowerPoint.'),'async function addPicture(file,at=null,options={}){return spBridgeInsertPicture(file,at,options); }');
replace('guard async picture replacement',sourceBetween('  async function replacePicture(file){','  async function addPicture(file,at=null,options={}){'),'async function replacePicture(file){return spBridgeReplacePicture(file); }');
replace('stage picture batch before one commit',sourceBetween("    $('#picture-upload').addEventListener('change',async e=>{","    $('#media-upload').addEventListener('change',"),"$('#picture-upload').addEventListener('change',e=>{const files=[...(e.target.files||[])].slice(0,6);e.target.value='';spBridgeInsertPictures(files);});");
// Compact workspace chrome reuses the editor's file commands and responsive toolbar.
replace('workspace home', '<div class="brandmark" aria-label="Superior Point">', '<button class="tool-compact sp-workspace-home" data-action="sp-workspace-home" title="返回工作台" aria-label="返回工作台">←</button><div class="brandmark" aria-label="Superior Point">');
replace('workspace share menu', '<div class="sp-header-actions" aria-label="文件和演示快捷操作">', `<details class="sp-workspace-share"><summary>分享 ↗</summary><div><button data-action="sp-workspace-audience">观众 HTML <small>仅放映，不含备注与批注</small></button><button data-action="export-reveal">备份 HTML <small>含完整项目、备注与批注</small></button><button data-action="sp-workspace-json">备份 JSON <small>完整项目数据</small></button><p class="sp-workspace-details" hidden></p></div></details><div class="sp-header-actions" aria-label="文件和演示快捷操作">`);
const patchedFileRibbon=html.slice(html.indexOf("    if(tab==='文件')html=["),html.indexOf("    if(tab==='开始' && v8IsMobile())")).trim();
replace('workspace file commands',patchedFileRibbon,`    if(tab==='文件')html=[
      group('项目',tool('工作台','folder-open','sp-workspace-home')+tool('新建','new-file','v10-create-open')+tool('打开','folder-open','open')+tool('保存','save','save-json')),
      group('备份与分享',tool('备份 HTML','download','export-reveal')+tool('备份 JSON','download','sp-workspace-json')+tool('观众 HTML','play','sp-workspace-audience')),
      group('其他格式',tool('PPTX','film','export-pptx')+tool('当前页 PNG','image','export-png')+tool('当前页 SVG','image','export-svg')+tool('打印 / PDF','film','export-print')),
      group('帮助',tool('上手指南','info','sp39-guide')+tool('完整 HTML','download','sp39-export-editable')+\`<span class="ribbon-hint">备份含备注、批注及历史；分享版仅供观众放映。</span>\`)
    ].join('');`);
// Preserve the native pane controls at normal laptop widths.
replace('laptop pane drag',"v8IsMobile()||window.innerWidth<1181||v9Focus","v8IsMobile()||v9Focus");
replace('left pane canvas bound',"Math.min(390,rect.width-650)","Math.max(155,Math.min(390,rect.width-280-($('#app').classList.contains('show-inspector')?v9Right:0)))");
replace('right pane canvas bound',"Math.min(430,rect.width-650)","Math.max(230,Math.min(430,rect.width-280-v9Left))");
replace('pane viewport bounds',"    el.style.setProperty('--v9-left',", "    if(innerWidth>=821){const width=$('.workspace')?.getBoundingClientRect().width||innerWidth;v9Right=clamp(v9Right,230,Math.max(230,Math.min(430,width-435)));v9Left=clamp(v9Left,155,Math.max(155,Math.min(390,width-280-(el.classList.contains('show-inspector')?v9Right:0))));}\n    el.style.setProperty('--v9-left',");

replace('timeline canvas bound',"Math.min(450,Math.floor(innerHeight*.57))","Math.max(135,Math.min(450,Math.floor(innerHeight*.57),v15Panel.getBoundingClientRect().height+$('.canvas-zone').getBoundingClientRect().height-180))");
replace('timeline keyboard canvas bound',"clamp(h+(e.key==='ArrowUp'?22:-22),135,450)","clamp(h+(e.key==='ArrowUp'?22:-22),135,Math.max(135,Math.min(450,h+$('.canvas-zone').getBoundingClientRect().height-180)))");
replace('pane keyboard isolation',"e.preventDefault();const delta=e.key==='Home'","e.preventDefault();e.stopPropagation();const delta=e.key==='Home'");
replace('timeline reset canvas bound',"(h>260?194:Math.min(390,innerHeight*.52))","Math.min(h>260?194:Math.min(390,innerHeight*.52),Math.max(135,h+$('.canvas-zone').getBoundingClientRect().height-180))");
replace('timeline keyboard isolation',"e.preventDefault();const h=v15Panel.getBoundingClientRect().height","e.preventDefault();e.stopPropagation();const h=v15Panel.getBoundingClientRect().height");
replace('compact workspace styles','\n</body>',`<style id="sp-workspace-css">${await read('tools/editor-workspace.css')}</style>\n</body>`);
html=html.replaceAll('保存状态以上方工作台为准','保存状态见文稿标题下方').replaceAll('观众分享版请在上方工作台另行导出','观众分享版请在分享菜单导出').replaceAll('观众分享版在上方工作台另行导出','观众分享版在分享菜单导出').replaceAll('上方工作台另行导出','分享菜单导出').replaceAll('上方工作台','工作台').replaceAll('上方按钮','文件选项卡').replaceAll('请以上方状态为准','请以文稿标题下方状态为准');
html=patchEffectGallery(html);patches.push('visual effects gallery and isolated hover previews');
const panels=await read('tools/editor-panel-layout.inc.js');
new Script(panels,{filename:'editor-panel-layout.js'});
const bridge=(await read('tools/editor-bridge.inc.js')).replace('bindEvents();v17BindEvents();', 'bindEvents();spPanelLayoutBoot();v17BindEvents();');
const pictures=await read('tools/editor-v038-image.inc.js');
// Reuse the canonical raster byte inspector rather than a divergent iframe copy.
const rasterChecks=`const spBridgeRasterAssets=(()=>{${(await read('io/image-assets.js')).replace(/^export /gm,'')}\nreturn {inspectRasterDataURL,IMAGE_LIMITS};})();`;
new Script(rasterChecks,{filename:'candidate-raster-checks.js'});
new Script(pictures,{filename:'candidate-picture-bridge.js'});
replace('explicit parent initialization',"  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();",`${panels}\n${bridge}\n${rasterChecks}\n${pictures}\n  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',spBridgeBoot,{once:true});else spBridgeBoot();`);
html=html.replaceAll('REVEAL.JS 6','REVEAL.JS · OFFLINE').replaceAll('Reveal.js 6 演示引擎','Reveal.js 离线候选演示引擎');
replace('candidate visible identity','<title>SuperiorPoint v0.39 — MiMo Workspace</title>','<title>SuperiorPoint v0.39 — MiMo Workspace · 集成版</title>');
html=html.replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>\s*<\/script>/gi,'');
for(const [index,match] of [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].entries()){if(!/type\s*=\s*[\"']application\/json/i.test(match[1]))new Script(match[2],{filename:'integrated-v039-script-'+index+'.js'});}
await writeFile(new URL('vendor/editor-integrated.js',root),`// Generated by tools/build-editor-integration.js. Do not edit.\n// Source SHA-256: ${sourceHash}\nexport const editorCandidateHTML=${JSON.stringify(html)};\nexport const editorCandidateSourceSHA256=${JSON.stringify(sourceHash)};\nexport const integratedEditorHTML=editorCandidateHTML;\nexport const integratedEditorSourceSHA256=editorCandidateSourceSHA256;\n`);
await writeFile(new URL('vendor/editor-integrated.manifest.json',root),JSON.stringify({source:'editor-v039.source.html',sourceSHA256:sourceHash,candidateSHA256:createHash('sha256').update(html).digest('hex'),patches,mode:'v039-integration-not-frozen',sourceVersion:'0.39',startup:{preserved:['sp39Bind MiMo design and mode','quick-access history from parent','guide and dialog focus','reduced motion','350ms IME-aware parent autosave','visibility flush'],excluded:['legacy template capture','legacy project recovery','embedded project auto-adoption','legacy project database writes'],htmlExport:'parent full editable data; contains notes/comments/history'},reveal:'bundled vendor/reveal-bundle.js'},null,2)+'\n');
console.log(`Built candidate editor (${Buffer.byteLength(html)} bytes); ${patches.length} explicit patches; source ${sourceHash}`);
