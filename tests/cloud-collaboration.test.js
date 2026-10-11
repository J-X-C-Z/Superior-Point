import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument,DocumentCore} from '../core/document-core.js';
import {mergeCloudDocument} from '../storage/cloud-collaboration.js';
const fixture=()=>createDocument({slides:[{id:'slide',elements:[{id:'text',type:'text',text:'before',x:0,y:0,w:100,h:50}]}]});
test('separate browser and AI fields merge, remote revisions advance and remote undo stays isolated',()=>{
 const base=fixture(),browser=new DocumentCore(base),ai=new DocumentCore(base);
 const mine=browser.edit([{type:'updateProject',properties:{title:'Browser'}}]);
 const theirs=ai.edit([{type:'updateElement',slideId:'slide',elementId:'text',properties:{text:'AI'}}]);
 const merged=mergeCloudDocument(base,mine,theirs);
 assert.equal(merged.title,'Browser');assert.equal(merged.slides[0].elements[0].text,'AI');assert.equal(merged.revision,theirs.revision+1);
 browser.synchronize(merged);assert.equal(browser.canUndo,false);assert.deepEqual(browser.getDocument(),merged);
 assert.deepEqual(mergeCloudDocument(base,base,theirs),theirs);
});
test('conflicting text and deletion versus edit preserve originals and refuse to overwrite',()=>{
 const base=fixture(),browser=new DocumentCore(base),ai=new DocumentCore(base);
 const mine=browser.edit([{type:'updateElement',slideId:'slide',elementId:'text',properties:{text:'Browser'}}]);
 const theirs=ai.edit([{type:'updateElement',slideId:'slide',elementId:'text',properties:{text:'AI'}}]);
 assert.throws(()=>mergeCloudDocument(base,mine,theirs),{code:'COLLABORATION_CONFLICT'});
 const deleted=structuredClone(theirs);deleted.slides[0].elements=[];
 assert.throws(()=>mergeCloudDocument(base,mine,deleted),{code:'COLLABORATION_CONFLICT'});
 assert.equal(mine.slides[0].elements[0].text,'Browser');assert.equal(theirs.slides[0].elements[0].text,'AI');
});
