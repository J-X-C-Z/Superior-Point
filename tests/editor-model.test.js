import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalToEditor,editorToCanonical,isEditorCandidateDocument} from '../adapters/editor-v038-model.js';
import {createDocument,DocumentCore,validateDocument,cloneJSON} from '../core/document-core.js';
import {fiveSlideDocument} from '../examples/five-slides.js';
const object=(id,type='shape',extra={})=>({id,type,x:20,y:30,w:100,h:80,...extra});
const native=()=>({version:1,name:'原始名称',width:1280,height:720,guides:[{axis:'v',value:42,future:[1,true]}],futureRoot:{keep:'yes'},metadata:{createdAt:'2024-01-02T00:00:00Z',author:'作者',extra:3},slides:[{id:'native-slide',name:'页面名称',bg:'#123456',background:{type:'gradient',from:'#112233',to:'#334455'},notes:'原始备注',comments:[{id:'comment-1',objectId:'text-1',replies:[{text:'保留回复'}],extra:[2]}],customHierarchy:['video-1','text-1'],objects:[object('video-1','video',{src:'data:video/mp4;base64,AA==',loop:true,media:{unknown:[1,2]},name:'视频'}),object('text-1','text',{text:'正文',groupId:'native-group',runs:[{text:'正文',bold:true}],anim:'fade',motionEffects:[{id:'native-fx',kind:'exit',effect:'zoom',step:2,duration:250,delay:10,trigger:'after',future:{keep:true}}],unknownObject:{nested:[3,'a']}})]}]});
function assertSourceFields(source,result){
 if(Array.isArray(source)){assert.equal(result.length,source.length);source.forEach((v,i)=>assertSourceFields(v,result[i]));}
 else if(source&&typeof source==='object'){for(const [key,value]of Object.entries(source))assertSourceFields(value,result[key]);}
 else assert.deepEqual(result,source);
}
test('native fields, original IDs, media, reviews, arrays and unknown extensions survive repeated mapping',()=>{
 const project=native(),original=cloneJSON(project);let doc=editorToCanonical(project);
 assert.equal(isEditorCandidateDocument(doc),true);
 doc.extensions.editorCandidate.futureExtension={preserve:true};
 for(let i=0;i<3;i++){
  const editor=canonicalToEditor(doc);assertSourceFields(original,editor);
  doc=editorToCanonical(editor,{baseDocument:doc});
 }
 assert.deepEqual(project,original);
 assert.deepEqual(doc.extensions.editorCandidate.futureExtension,{preserve:true});
});
test('five canonical sample pages map to editable objects and preserve table primitive types',()=>{
 const original=fiveSlideDocument(),deck=canonicalToEditor(original),copy=cloneJSON(original);
 assert.equal(deck.slides.length,5);
 const table=deck.slides[3].objects.find(o=>o.id==='table');
 assert.equal(table.rows,4);assert.equal(table.cols,2);assert.equal(table.cells[1][1],'12');
 const unchanged=editorToCanonical(deck,{baseDocument:original});
 assert.deepEqual(unchanged.slides[3].elements.find(o=>o.id==='table').rows,original.slides[3].elements.find(o=>o.id==='table').rows);
 assert.equal(unchanged.slides[0].background,original.slides[0].background);
 deck.slides.forEach(s=>{s.objects[0].text='编辑 '+s.id;s.notes='备注 '+s.id;});
 table.cells[1][1]='15';
 const changed=editorToCanonical(deck,{baseDocument:original});
 assert.equal(changed.slides[3].elements.find(o=>o.id==='table').rows[1][1],'15');
 assert.equal(changed.slides[3].elements.find(o=>o.id==='table').rows[2][1],9);
 assert.ok(changed.slides.every(s=>s.elements[0].text==='编辑 '+s.id&&s.notes==='备注 '+s.id));
 assert.equal(validateDocument(changed).valid,true);assert.deepEqual(original,copy);
 const core=new DocumentCore(changed);
 core.edit([{type:'updateElement',slideId:'slide-4',elementId:'table',properties:{rows:[['New',23]]}}]);
 assert.deepEqual(canonicalToEditor(core.getDocument()).slides[3].objects.find(o=>o.id==='table').cells,[['New','23']]);
});
test('replacing one image source releases its old shared asset reference without changing other images',()=>{
 const doc=fiveSlideDocument();doc.slides[1].elements.push(object('image-copy','image',{assetId:'demo-image'}));
 let deck=canonicalToEditor(doc);deck.slides[1].objects.find(o=>o.id==='image').src='data:image/png;base64,NEW';
 let changed=editorToCanonical(deck,{baseDocument:doc});
 assert.equal(changed.slides[1].elements.find(o=>o.id==='image').assetId,undefined);
 assert.deepEqual(changed.assets,doc.assets);
 deck=canonicalToEditor(changed);
 assert.equal(deck.slides[1].objects.find(o=>o.id==='image').src,'data:image/png;base64,NEW');
 assert.equal(deck.slides[1].objects.find(o=>o.id==='image-copy').src,doc.assets[0].dataUrl);
 const core=new DocumentCore(changed);
 core.edit([{type:'updateElement',slideId:'slide-2',elementId:'image-copy',properties:{src:'data:image/png;base64,MCP'}}]);
 deck=canonicalToEditor(core.getDocument());
 assert.equal(deck.slides[1].objects.find(o=>o.id==='image-copy').src,'data:image/png;base64,MCP');
 assert.equal(deck.slides[1].objects.find(o=>o.id==='image-copy').assetId,undefined);
 changed=editorToCanonical(deck,{baseDocument:core.getDocument()});
 assert.equal(changed.slides[1].elements.find(o=>o.id==='image-copy').src,'data:image/png;base64,MCP');
});
test('native animation edits persist until a subsequent Core setAnimation changes their source',()=>{
 let doc=fiveSlideDocument(),deck=canonicalToEditor(doc),item=deck.slides[2].objects.find(o=>o.id==='step-2');
 assert.equal(item.anim,'fade');item.anim='zoom';item.animDuration=780;
 doc=editorToCanonical(deck,{baseDocument:doc});deck=canonicalToEditor(doc);
 item=deck.slides[2].objects.find(o=>o.id==='step-2');assert.equal(item.anim,'zoom');assert.equal(item.animDuration,780);
 item.motionEffects=[{id:'custom-native-fx',kind:'exit',effect:'float',step:3,duration:1200,delay:10,trigger:'after',custom:[1,2]}];item.anim='none';
 doc=editorToCanonical(deck,{baseDocument:doc});deck=canonicalToEditor(doc);
 assert.deepEqual(deck.slides[2].objects.find(o=>o.id==='step-2').motionEffects,item.motionEffects);
 const core=new DocumentCore(doc),a=doc.slides[2].animations[0];
 core.edit([{type:'setAnimation',slideId:'slide-3',animation:{...a,type:'spin',duration:1.25,delay:.2,order:4}}]);
 deck=canonicalToEditor(core.getDocument());item=deck.slides[2].objects.find(o=>o.id==='step-2');
 assert.equal(item.motionEffects[0].effect,'spin');assert.equal(item.motionEffects[0].duration,1250);assert.equal(item.motionEffects[0].delay,200);
 doc=editorToCanonical(deck,{baseDocument:core.getDocument()});const core2=new DocumentCore(doc);
 core2.edit([{type:'setAnimation',slideId:'slide-3',animation:null,animationId:a.id}]);
 item=canonicalToEditor(core2.getDocument()).slides[2].objects.find(o=>o.id==='step-2');
 assert.equal(item.anim,'none');assert.deepEqual(item.motionEffects,[]);
});
test('flat groups retain placement, child order, unknown fields and empty groups; unsupported nested groups fail explicitly',()=>{
 const doc=createDocument({slides:[{id:'s',elements:[object('a'),object('g','group',{children:['b','a'],custom:[1]}),object('b'),object('empty','group',{children:[]})],animations:[]}]});
 const deck=canonicalToEditor(doc),roundtrip=editorToCanonical(deck,{baseDocument:doc});
 assert.deepEqual(roundtrip.slides[0].elements.map(o=>o.id),doc.slides[0].elements.map(o=>o.id));
 assert.deepEqual(roundtrip.slides[0].elements.find(o=>o.id==='g'),doc.slides[0].elements.find(o=>o.id==='g'));
 assert.deepEqual(roundtrip.slides[0].elements.find(o=>o.id==='empty'),doc.slides[0].elements.find(o=>o.id==='empty'));
 for(const o of deck.slides[0].objects)delete o.groupId;
 assert.equal(editorToCanonical(deck,{baseDocument:doc}).slides[0].elements.some(o=>o.id==='g'),false);
 const core=new DocumentCore(roundtrip);core.edit([{type:'ungroupElements',slideId:'s',groupId:'g'}]);
 assert.ok(canonicalToEditor(core.getDocument()).slides[0].objects.every(o=>!o.groupId));
 const nested=cloneJSON(doc);nested.slides[0].elements.push(object('outer','group',{children:['g']}));
 assert.throws(()=>canonicalToEditor(nested),{code:'EDITOR_UNSUPPORTED_GROUP'});
 assert.equal(nested.slides[0].elements.length,5);
});
test('snapshot replacement is revision-checked, detached, atomic and undoable; identity remains owned by Core',()=>{
 const original=fiveSlideDocument(),core=new DocumentCore(original),deck=canonicalToEditor(original);
 deck.name='编辑后的项目';deck.slides[0].objects[0].x=123;
 const snapshot=editorToCanonical(deck,{baseDocument:original});
 assert.throws(()=>core.edit([{type:'replaceContent',document:snapshot}],{expectedRevision:1}),{code:'REVISION_CONFLICT'});
 assert.deepEqual(core.getDocument(),original);assert.equal(core.canUndo,false);
 for(const alter of [d=>d.id='foreign',d=>d.revision++,d=>d.metadata.createdAt='2000-01-01T00:00:00Z']){
  const invalid=cloneJSON(snapshot);alter(invalid);
  assert.throws(()=>core.edit([{type:'replaceContent',document:invalid}],{expectedRevision:0}),{code:'INVALID_OPERATION'});
  assert.deepEqual(core.getDocument(),original);assert.equal(core.canUndo,false);
 }
 assert.throws(()=>core.edit([{type:'replaceContent',document:snapshot},{type:'deleteSlide',slideId:'missing'}],{expectedRevision:0}));
 assert.deepEqual(core.getDocument(),original);assert.equal(core.canUndo,false);
 const result=core.edit([{type:'replaceContent',document:snapshot}],{expectedRevision:0});
 assert.equal(result.revision,1);assert.equal(result.id,original.id);assert.equal(result.metadata.createdAt,original.metadata.createdAt);
 snapshot.title='alias leak';result.title='return leak';assert.equal(core.getDocument().title,'编辑后的项目');
 const undo=core.undo({expectedRevision:1});assert.equal(undo.revision,2);assert.deepEqual(undo.slides,original.slides);
 const redo=core.redo({expectedRevision:2});assert.equal(redo.revision,3);assert.equal(redo.title,'编辑后的项目');
});
test('native duplicated animation fields and new Core emphasis effects stay editable',()=>{
 let doc=fiveSlideDocument(),deck=canonicalToEditor(doc);
 const original=deck.slides[2].objects.find(o=>o.id==='step-2'),copy=cloneJSON(original);
 copy.id='native-object-copy';copy.anim='zoom';deck.slides[2].objects.push(copy);
 doc=editorToCanonical(deck,{baseDocument:doc});deck=canonicalToEditor(doc);
 assert.equal(deck.slides[2].objects.find(o=>o.id===copy.id).anim,'zoom');
 const core=new DocumentCore(doc);
 core.edit([{type:'setAnimation',slideId:'slide-3',animation:{id:'new-emphasis',targetId:copy.id,type:'spin',trigger:'after',duration:.8,delay:.1,order:3,easing:'linear'}}]);
 const projected=canonicalToEditor(core.getDocument()).slides[2].objects.find(o=>o.id===copy.id);
 assert.equal(projected.motionEffects[0].kind,'emphasis');assert.equal(projected.motionEffects[0].effect,'spin');assert.equal(projected.motionEffects[0].trigger,'after');
 assert.equal(deck.slides[2].objects.find(o=>o.type==='connector').strokeWidth,2);
});
