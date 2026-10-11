import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalToEditor,editorToCanonical} from '../adapters/editor-v038-model.js';
import {createDocument,cloneJSON,DocumentCore} from '../core/document-core.js';
import {candidateHarness} from './helpers/editor-candidate.js';

const object=(id,type='shape',extra={})=>({id,type,x:20,y:30,w:100,h:80,...extra});
const fixture=()=>createDocument({slides:[{id:'s',elements:[
 object('hidden','text',{hidden:true,text:'保留隐藏正文',future:{keep:[1,2]}}),
 object('legacy','shape',{visible:false}),
 object('both','shape',{hidden:true,visible:false}),
 object('group','group',{hidden:true,children:['child','explicit-child','legacy-child']}),
 object('child'),object('explicit-child','shape',{visible:true}),object('legacy-child','shape',{visible:false}),
 object('legacy-group','group',{visible:false,children:['other-child']}),object('other-child'),object('shown')
],animations:[]}]});
const byId=doc=>new Map(doc.slides[0].elements.map(o=>[o.id,o]));

test('Core hidden and hidden group descendants project native visibility without losing data or flags',()=>{
 let doc=fixture();const input=doc,original=cloneJSON(doc),source=byId(original);
 for(let i=0;i<3;i++){
  const deck=canonicalToEditor(doc),objects=deck.slides[0].objects;
  assert.deepEqual(objects.filter(o=>o.visible!==false).map(o=>o.id),['shown']);
  assert.equal(objects.find(o=>o.id==='hidden').text,'保留隐藏正文');
  doc=editorToCanonical(deck,{baseDocument:doc});
  for(const [id,before]of source){
   if(id==='shown')continue;
   const after=byId(doc).get(id);
   for(const field of ['hidden','visible']){
    assert.equal(Object.hasOwn(after,field),Object.hasOwn(before,field),id+' '+field);
    assert.deepEqual(after[field],before[field],id+' '+field);
   }
  }
  assert.deepEqual(byId(doc).get('hidden').future,{keep:[1,2]});
  assert.equal(doc.slides[0].elements.length,original.slides[0].elements.length);
 }
 assert.deepEqual(input,original);
});

test('showing a native hidden object updates its Core hidden flag, while group hiding remains inherited',()=>{
 const doc=fixture(),deck=canonicalToEditor(doc);
 for(const id of ['hidden','both','child'])deck.slides[0].objects.find(o=>o.id===id).visible=true;
 const changed=editorToCanonical(deck,{baseDocument:doc}),elements=byId(changed);
 assert.equal(elements.get('hidden').hidden,false);assert.equal(elements.get('both').hidden,false);
 assert.equal(elements.get('group').hidden,true);
 const projected=canonicalToEditor(changed).slides[0].objects;
 assert.equal(projected.find(o=>o.id==='hidden').visible,true);
 assert.equal(projected.find(o=>o.id==='both').visible,true);
 assert.equal(projected.find(o=>o.id==='child').visible,false);
});

test('Core unhide and ungroup do not leave projected visibility on formerly inherited children',()=>{
 const doc=fixture(),roundtrip=editorToCanonical(canonicalToEditor(doc),{baseDocument:doc}),core=new DocumentCore(roundtrip);
 core.edit([
  {type:'updateElement',slideId:'s',elementId:'hidden',properties:{hidden:false}},
  {type:'updateElement',slideId:'s',elementId:'group',properties:{hidden:false}},
  {type:'ungroupElements',slideId:'s',groupId:'legacy-group'}
 ]);
 const objects=canonicalToEditor(core.getDocument()).slides[0].objects;
 assert.deepEqual(objects.filter(o=>o.visible!==false).map(o=>o.id),['hidden','child','explicit-child','other-child','shown']);
});

test('native editing stage omits hidden content while its initialized snapshot preserves it',async()=>{
 const doc=fixture(),h=await candidateHarness(canonicalToEditor(doc));
 try{
  assert.deepEqual([...h.window.document.querySelectorAll('#stage-mount .slide-object[data-id]')].map(node=>node.dataset.id),['shown']);
  const snapshot=JSON.parse(JSON.stringify(h.window.SPEditorCandidate.getSnapshot()));
  const roundtrip=byId(editorToCanonical(snapshot,{baseDocument:doc}));
  assert.equal(roundtrip.get('hidden').hidden,true);assert.equal(roundtrip.get('hidden').text,'保留隐藏正文');
  assert.equal(roundtrip.get('group').hidden,true);assert.equal(Object.hasOwn(roundtrip.get('child'),'visible'),false);
  assert.equal(snapshot.slides[0].objects.length,8);
  assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});
