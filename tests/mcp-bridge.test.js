import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createsBridgeServer} from '../mcp/bridge/server.js';

test('bridge rejects unsafe transport origins and symlink roots',async()=>{
 for(const apiUrl of ['http://example.com','http://127.0.0.1','https://user:password@example.com','https://example.com/path','file:///tmp'])await assert.rejects(createsBridgeServer({apiUrl,token:'test'}),{code:'INVALID_API_URL'});
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'sp-bridge-')));
 try {await symlink(root,path.join(root,'link'));await assert.rejects(createsBridgeServer({apiUrl:'https://example.com',token:'test',root:path.join(root,'link')}),{code:'OUT_OF_SCOPE'});}finally{await rm(root,{recursive:true,force:true});}
});

test('real SDK stdio retries identical atomic mutation without a lease, keeps snapshot exclusivity and redacts errors',async()=>{
 const requests=[];let edits=0,released=0,busy=false;
 const secret='sp_pat_'+'a'.repeat(43);
 const api=http.createServer(async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk;const body=text?JSON.parse(text):undefined;requests.push({method:req.method,url:req.url,body});
  assert.equal(req.headers.authorization,'Bearer '+secret);
  res.setHeader('Content-Type','application/json');
  if(req.url.endsWith('/lease')&&req.method==='POST'){if(busy){res.statusCode=409;res.end(JSON.stringify({error:{code:'PROJECT_BUSY',message:'Busy'}}));}else res.end(JSON.stringify({leaseToken:'lease-one'}));return;}
  if(req.url.endsWith('/lease')&&req.method==='DELETE'){released++;res.end('{"released":true}');return;}
  if(req.method==='PATCH'){edits++;if(edits<=2){req.socket.destroy();return;}res.end('{"id":"project","revision":1}');return;}
  res.statusCode=401;res.end(JSON.stringify({error:{code:'UNAUTHORIZED',message:'Echo '+secret,details:{credential:secret}}}));
 });
 await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
 const client=new Client({name:'bridge-unit',version:'1'});
 try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('mcp/bridge/server.js')],env:{SP_API_URL:'http://127.0.0.1:'+api.address().port,SP_API_TOKEN:secret,SP_BRIDGE_ALLOW_HTTP:'1'},stderr:'pipe'}));
  assert.equal((await client.listTools()).tools.length,22);
  const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});return {error:result.isError,value:JSON.parse(result.content[0].text)};};
  const args={projectId:'project',expectedRevision:0,operations:[{type:'updateProject',properties:{title:'saved'}}]};
  const uncertain=await call('sp_edit',args);assert.equal(uncertain.value.error.code,'API_UNAVAILABLE');assert.ok(uncertain.value.error.details.clientMutationId);
  assert.equal((await call('sp_edit',args)).value.revision,1);
  const writes=requests.filter(r=>r.method==='PATCH');assert.equal(writes.length,3);for(const write of writes)assert.deepEqual(write.body,writes[0].body);assert.equal(writes[0].body.clientMutationId,uncertain.value.error.details.clientMutationId);assert.equal(Object.hasOwn(writes[0].body,'leaseToken'),false);assert.equal(released,0);assert.equal(requests.filter(r=>r.method==='POST'&&r.url.endsWith('/lease')).length,0);
  busy=true;assert.equal((await call('sp_edit',{...args,expectedRevision:1})).value.revision,1);assert.equal(edits,4);
  assert.equal((await call('sp_edit',{...args,expectedRevision:1,operations:[...args.operations,{type:'replaceContent',document:{}}]})).value.error.code,'PROJECT_BUSY');assert.equal(edits,4);
  busy=false;assert.equal((await call('sp_edit',{...args,expectedRevision:1,operations:[{type:'replaceContent',document:{}}]})).value.revision,1);assert.equal(released,1);assert.equal(requests.at(-2).body.leaseToken,'lease-one');
  const denied=await call('sp_get_document',{projectId:'project'});assert.equal(denied.error,true);assert.ok(!JSON.stringify(denied).includes(secret));
  assert.equal((await call('sp_open_project',{filename:'../bad.html'})).value.error.code,'ROOT_REQUIRED');
 }finally{await client.close();await new Promise(resolve=>api.close(resolve));}
});
