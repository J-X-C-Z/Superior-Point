import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import {mountObservability} from '../web/admin/observability.js';
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
const fixture={generatedAt:new Date().toISOString(),application:{status:'ok',uptimeSeconds:1,cpu:{oneCorePercent:1},memory:{rssBytes:1000,heapUsedBytes:500},cgroup:{status:'unavailable',reason:'unit-test platform'},disk:{status:'unavailable'}},api:{status:'ok'},database:{status:'ok',connections:2,active:1,probeDurationMs:1},host:{status:'unavailable',reason:'未配置整机只读采集文件'}};
test('observability UI sends actual server filters/pages, renders safe metadata and cancels its timer',async()=>{
 const dom=new JSDOM('<main></main>'),container=dom.window.document.querySelector('main'),requests=[];let intervalCallback,cleared=false;
 dom.window.setInterval=callback=>{intervalCallback=callback;return 123;};dom.window.clearInterval=id=>{assert.equal(id,123);cleared=true;};
 const api={async request(url){requests.push(url);if(url.includes('/resources'))return fixture;const offset=Number(new URL(url,'http://test').searchParams.get('offset'));return {total:26,summary:{calls:26,errors:1,errorRate:1/26,averageDurationMs:2},rows:[{createdAt:new Date().toISOString(),userId:'<img src=x onerror=evil()>',tool:'sp_get_document',transport:'streamable-http',outcome:'success',durationMs:2,errorCode:null}],offset};}};
 const mounted=mountObservability({container,api});await settle();
 assert.match(container.textContent,/26 条已记录调用/);assert.match(container.textContent,/未配置整机只读采集文件/);assert.equal(container.querySelectorAll('img').length,0);
 container.querySelector('input[name="userId"]').value='00000000-0000-0000-0000-000000000001';container.querySelector('select[name="tool"]').value='sp_edit';
 container.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();
 const query=new URL(requests.filter(url=>url.includes('/tools?')).at(-1),'http://test').searchParams;assert.equal(query.get('userId'),'00000000-0000-0000-0000-000000000001');assert.equal(query.get('tool'),'sp_edit');assert.ok(query.get('from'));assert.ok(query.get('to'));
 [...container.querySelectorAll('button')].find(button=>button.textContent==='下一页').click();await settle();assert.match(requests.filter(url=>url.includes('/tools?')).at(-1),/offset=25/);
 intervalCallback();await settle();mounted.destroy();assert.equal(cleared,true);const before=requests.length;intervalCallback();await settle();assert.equal(requests.length,before);dom.window.close();
});
test('destroy prevents delayed results from changing an unmounted dashboard',async()=>{
 const dom=new JSDOM('<main></main>'),container=dom.window.document.querySelector('main');let finish;
 const pending=new Promise(resolve=>{finish=resolve;});const mounted=mountObservability({container,api:{request:()=>pending}});mounted.destroy();const original=container.textContent;finish(fixture);await settle();assert.equal(container.textContent,original);dom.window.close();
});

test('host collector computes numeric counters from a fixed Linux unit fixture without privileged access',()=>{
 const output=execFileSync('python3',['-c',`import importlib.util, types
spec=importlib.util.spec_from_file_location('collector','deploy/hakari/collect-metrics.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
samples=iter([(100,20),(200,45)])
m.cpu=lambda:next(samples)
m.time.sleep=lambda duration:None
m.Path=lambda path:types.SimpleNamespace(read_text=lambda:'MemTotal: 100 kB\\nMemAvailable: 40 kB\\n')
m.os.statvfs=lambda path:types.SimpleNamespace(f_blocks=100,f_frsize=4096,f_bavail=20)
data=m.collect()
assert data['cpu']['percent']==75
assert data['memory']=={'totalBytes':102400,'availableBytes':40960}
assert data['disk']=={'totalBytes':409600,'availableBytes':81920}
assert set(data)=={'source','generatedAt','cpu','memory','disk'}
print('collector fixture passed')`],{encoding:'utf8'});assert.match(output,/fixture passed/);
});
