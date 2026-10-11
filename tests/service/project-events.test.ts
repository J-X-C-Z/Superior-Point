import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {registerProjectEvents} from '../../server/project-events.js';
import {AuthService} from '../../server/auth/auth-service.js';
import {TokenService} from '../../server/auth/token-service.js';
import {ProjectService} from '../../server/services/project-service.js';
import {cleanupTestDatabase,createTestDatabase} from './helpers.js';
const password='project-events-test-password!';
async function setup(){const db=await createTestDatabase(),auth=new AuthService(db);await auth.bootstrapAdmin('events-admin',password);const login=await auth.login('events-admin',password),owner=await auth.authenticate(login.sessionToken);await auth.createUser(owner,{username:'events-other',password});const otherLogin=await auth.login('events-other',password),other=await auth.authenticate(otherLogin.sessionToken);const projects=new ProjectService(db),document=await projects.create(owner,{title:'Never send document body'});const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));const origin='http://127.0.0.1:'+port,app=Fastify();app.setErrorHandler((error,_,reply)=>reply.code((error as any).status??500).send({error:{code:(error as any).code}}));registerProjectEvents(app,{db,origin,pollMs:25,actor:request=>auth.authenticate((request.headers.cookie??'').split('=')[1]??'')});await app.listen({host:'127.0.0.1',port});return {db,auth,owner,other,login,otherLogin,projects,document,origin,app,close:async()=>{await app.close();await cleanupTestDatabase(db);}};}
function reader(response:Response){const stream=response.body!.getReader();let buffer='';return {async next(name:string){for(;;){const boundary=buffer.indexOf('\n\n');if(boundary>=0){const part=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);if(part.includes('event: '+name+'\n')){const data=JSON.parse(part.split('\n').find(line=>line.startsWith('data: '))!.slice(6));return {data,id:part.split('\n').find(line=>line.startsWith('id: '))?.slice(4),raw:part};}continue;}const chunk=await stream.read();if(chunk.done)throw Error('Stream ended before '+name);buffer+=new TextDecoder().decode(chunk.value);}},cancel:()=>stream.cancel()};}
function open(h:Awaited<ReturnType<typeof setup>>,extra:{headers?:Record<string,string>;accountId?:string;id?:string;signal?:AbortSignal}={}){return fetch(h.origin+'/api/v1/projects/'+(extra.id??h.document.id)+'/events?accountId='+(extra.accountId??h.owner.id),{headers:{Cookie:'sp-session='+h.login.sessionToken,...extra.headers},signal:extra.signal});}
test('SSE sends committed Agent revisions only, reconnect catches latest state and shutdown closes stream',async()=>{const h=await setup();let active:ReturnType<typeof reader>|undefined;try{
 const response=await open(h);assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/^text\/event-stream/);assert.equal(response.headers.get('x-accel-buffering'),'no');active=reader(response);const initial=await active.next('revision');assert.deepEqual(initial.data,{projectId:h.document.id,revision:0,deleted:false});assert.equal(initial.id,'0');assert.doesNotMatch(initial.raw,/Never send document body|title|session|token/);
 const tokens=new TokenService(h.db),issued=await tokens.create(h.owner,{name:'event Agent',scopes:['projects:read','projects:write']}),agent=await tokens.authenticate(issued.token);
 await assert.rejects(h.projects.edit(agent,h.document.id,{expectedRevision:9,clientMutationId:'failed-event',operations:[{type:'updateProject',properties:{title:'Failed'}}]}));
 await h.projects.edit(agent,h.document.id,{expectedRevision:0,clientMutationId:'committed-event',operations:[{type:'updateProject',properties:{title:'Committed Agent change'}}]});assert.equal((await active.next('revision')).data.revision,1);await active.cancel();active=undefined;
 await h.projects.edit(agent,h.document.id,{expectedRevision:1,clientMutationId:'offline-event',operations:[{type:'updateProject',properties:{title:'Agent change while disconnected'}}]});
 const reconnected=await open(h,{headers:{'Last-Event-ID':'1'}});active=reader(reconnected);assert.equal((await active.next('revision')).data.revision,2);
 await h.projects.remove(h.owner,h.document.id,{expectedRevision:2,clientMutationId:'trash-event'});assert.equal((await active.next('revision')).data.deleted,true);
 await h.app.close();await active.cancel();active=undefined;
 }finally{await active?.cancel();await h.close();}});
test('SSE enforces same-origin sessions, account guard, live revocation and project ownership',async()=>{const h=await setup();let active:ReturnType<typeof reader>|undefined;try{
 assert.equal((await open(h,{headers:{Origin:'https://evil.invalid'}})).status,403);assert.equal((await open(h,{headers:{Authorization:'Bearer anything'}})).status,403);assert.equal((await open(h,{headers:{Cookie:'sp-session=unknown'}})).status,401);assert.equal((await open(h,{accountId:h.other.id})).status,403);assert.equal((await open(h,{id:randomUUID()})).status,404);
 assert.equal((await open(h,{headers:{Cookie:'sp-session='+h.otherLogin.sessionToken},accountId:h.other.id})).status,404);assert.equal((await open(h,{headers:{'Last-Event-ID':'invalid'}})).status,400);
 active=reader(await open(h));await active.next('revision');await h.auth.logout(h.login.sessionToken);assert.equal((await active.next('access-revoked')).data.code,'UNAUTHENTICATED');await active.cancel();active=undefined;
 const login=await h.auth.login('events-admin',password);h.login=login;active=reader(await open(h));await active.next('revision');await h.db.query('UPDATE projects SET owner_id=$2 WHERE id=$1',[h.document.id,h.other.id]);assert.equal((await active.next('access-revoked')).data.code,'NOT_FOUND');
 }finally{await active?.cancel();await h.close();}});
test('SSE rejects a forged HTTP Host and bounds per-account connections',async()=>{const h=await setup(),responses:Response[]=[];try{
 const {request}=await import('node:http');const status=await new Promise<number>((resolve,reject)=>{const req=request(h.origin+'/api/v1/projects/'+h.document.id+'/events?accountId='+h.owner.id,{headers:{Host:'evil.invalid',Cookie:'sp-session='+h.login.sessionToken}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});req.on('error',reject);req.end();});assert.equal(status,403);
 for(let i=0;i<5;i++){const response=await open(h);assert.equal(response.status,200);responses.push(response);}
 const excess=await open(h);assert.equal(excess.status,429);assert.equal(excess.headers.get('retry-after'),'10');
 await h.app.close();
 }finally{for(const response of responses)await response.body?.cancel();await h.close();}});
