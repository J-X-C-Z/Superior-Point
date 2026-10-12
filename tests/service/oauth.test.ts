import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {createHash,randomBytes} from 'node:crypto';
import {auth as sdkAuth, type OAuthClientProvider} from '@modelcontextprotocol/sdk/client/auth.js';
import type {OAuthClientInformationMixed,OAuthTokens} from '@modelcontextprotocol/sdk/shared/auth.js';
import {AuthService} from '../../server/auth/auth-service.js';
import {TokenService} from '../../server/auth/token-service.js';
import {OAuthService} from '../../server/auth/oauth-service.js';
import {registerOAuthRoutes} from '../../server/auth/oauth-routes.js';
import {ProjectService} from '../../server/services/project-service.js';
import {createTestDatabase,cleanupTestDatabase} from './helpers.js';
const password='oauth-test-long-password!';
async function setup(){const db=await createTestDatabase(),web=new AuthService(db);await web.bootstrapAdmin('admin',password);const login=await web.login('admin',password),actor=await web.authenticate(login.sessionToken);const app=Fastify();await app.listen({host:'127.0.0.1',port:0});const address=app.server.address() as {port:number};await app.close();const server=Fastify(),origin='http://127.0.0.1:'+address.port,service=new OAuthService(db,origin);registerOAuthRoutes(server,{db,origin,auth:web,actor:async()=>actor,service});await server.listen({host:'127.0.0.1',port:address.port});return {db,web,actor,login,server,service,origin,close:async()=>{await server.close();await cleanupTestDatabase(db);}};}
async function post(origin:string,path:string,body:Record<string,string>){return fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});}
test('SDK discovery, public registration, S256 flow, explicit consent, scopes, resource binding and revocation',async()=>{const h=await setup();try{
 let client:OAuthClientInformationMixed|undefined,tokens:OAuthTokens|undefined,verifier='',authorization:URL|undefined;
 const provider:OAuthClientProvider={redirectUrl:'http://127.0.0.1:43123/callback',clientMetadata:{client_name:'SDK test',redirect_uris:['http://127.0.0.1:43123/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code']},state:()=> 'own-state',clientInformation:()=>client,saveClientInformation:v=>{client=v;},tokens:()=>tokens,saveTokens:v=>{tokens=v;},saveCodeVerifier:v=>{verifier=v;},codeVerifier:()=>verifier,redirectToAuthorization:v=>{authorization=v;}};
 assert.equal(await sdkAuth(provider,{serverUrl:h.origin+'/mcp',scope:'projects:read'}),'REDIRECT');assert.ok(client);assert.ok(authorization);assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');assert.equal(authorization.searchParams.get('resource'),h.origin+'/mcp');
 const own=await new ProjectService(h.db).create(h.actor,{title:'Owned deck'});const outside=await new ProjectService(h.db).create(h.actor,{title:'Outside grant'});
 const authResponse=await fetch(authorization,{redirect:'manual'});assert.equal(authResponse.status,302);const consentUrl=new URL(authResponse.headers.get('location')!);const request=consentUrl.searchParams.get('request')!;const details=await h.service.consent(request);assert.deepEqual(details.scopes,['projects:read']);assert.equal((await h.db.query('SELECT * FROM api_tokens')).rowCount,0);
 const deny=await fetch(h.origin+'/oauth/consent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request,approve:true,projectAllowlist:[]})});assert.equal(deny.status,403);
 const approved=await fetch(h.origin+'/oauth/consent',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':h.login.csrfToken},body:JSON.stringify({request,approve:true,projectAllowlist:[own.id]})});assert.equal(approved.status,200);const code=new URL((await approved.json()).redirect).searchParams.get('code')!;
 const wrong=await post(h.origin,'/token',{grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:'wrong'.repeat(12),redirect_uri:String(provider.redirectUrl),resource:h.origin+'/mcp'});assert.equal(wrong.status,400);assert.equal((await wrong.json()).error,'invalid_grant');
 assert.equal(await sdkAuth(provider,{serverUrl:h.origin+'/mcp',authorizationCode:code}),'AUTHORIZED');assert.ok(tokens);assert.equal(tokens.refresh_token,undefined);const actor=await h.service.authenticate(tokens.access_token);assert.deepEqual(actor.scopes,['projects:read']);assert.deepEqual(actor.projectAllowlist,[own.id]);assert.equal((await new ProjectService(h.db).list(actor)).length,1);await assert.rejects(new ProjectService(h.db).get(actor,outside.id));await assert.rejects(new ProjectService(h.db).remove(actor,own.id,{expectedRevision:0,clientMutationId:'forbidden'}));
 await assert.rejects(new TokenService(h.db).authenticate(tokens.access_token));await assert.rejects(new OAuthService(h.db,'http://127.0.0.1:49999').authenticate(tokens.access_token));
 const replay=await post(h.origin,'/token',{grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:verifier,redirect_uri:String(provider.redirectUrl),resource:h.origin+'/mcp'});assert.equal(replay.status,400);
 const other=await h.service.clientsStore.registerClient(provider.clientMetadata);await h.service.revokeToken(other,{token:tokens.access_token});await h.service.authenticate(tokens.access_token);
 const revoked=await post(h.origin,'/revoke',{client_id:client.client_id,token:tokens.access_token});assert.equal(revoked.status,200);await assert.rejects(h.service.authenticate(tokens.access_token));
 assert.equal((await fetch(h.origin+'/.well-known/oauth-authorization-server').then(r=>r.json())).grant_types_supported.join(','),'authorization_code');
 }finally{await h.close();}});
test('OAuth rejects unsafe clients, redirect/resource escalation, plain PKCE, consumed/expired grants and inactive users',async()=>{const h=await setup();try{
 await assert.rejects(h.service.clientsStore.registerClient({redirect_uris:['http://evil.example/cb'],token_endpoint_auth_method:'none'}));await assert.rejects(h.service.clientsStore.registerClient({redirect_uris:['https://client.example/cb'],token_endpoint_auth_method:'client_secret_post'}));
 const client=await h.service.clientsStore.registerClient({redirect_uris:['https://client.example/cb'],token_endpoint_auth_method:'none'}),verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
 async function begin(extra:Record<string,string>={}){const params=new URLSearchParams({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge:challenge,code_challenge_method:'S256',resource:h.origin+'/mcp',scope:'projects:read',...extra});return fetch(h.origin+'/authorize?'+params,{redirect:'manual'});}
 assert.equal((await begin({redirect_uri:'https://evil.example/cb'})).status,400);assert.equal((await begin({client_id:'unknown'})).status,400);
 for(const extra of ([{resource:'https://other.example/mcp'},{scope:'admin'},{code_challenge_method:'plain'}] as Record<string,string>[])){const response=await begin(extra);assert.equal(response.status,302);assert.ok(new URL(response.headers.get('location')!).searchParams.has('error'));}
 const start=await begin(),request=new URL(start.headers.get('location')!).searchParams.get('request')!;const target=await h.service.approve(h.actor,request,[],true),code=new URL(target).searchParams.get('code')!;await assert.rejects(h.service.approve(h.actor,request,[],true));
 const exchange=(resource:string)=>post(h.origin,'/token',{grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:verifier,redirect_uri:client.redirect_uris[0],resource});assert.equal((await exchange(h.origin+'/other')).status,400);
 const expired=await begin(),expiredId=new URL(expired.headers.get('location')!).searchParams.get('request')!;const expiredCode=new URL(await h.service.approve(h.actor,expiredId,[],true)).searchParams.get('code')!;await h.db.query("UPDATE oauth_codes SET expires_at=clock_timestamp()-interval '1 second' WHERE code_hash=$1",[createHash('sha256').update(expiredCode).digest('hex')]);assert.equal((await post(h.origin,'/token',{grant_type:'authorization_code',client_id:client.client_id,code:expiredCode,code_verifier:verifier,redirect_uri:client.redirect_uris[0],resource:h.origin+'/mcp'})).status,400);
 const good=await exchange(h.origin+'/mcp');assert.equal(good.status,200);const token=(await good.json()).access_token;await h.db.query("UPDATE users SET status='disabled' WHERE id=$1",[h.actor.id]);await assert.rejects(h.service.authenticate(token));
 }finally{await h.close();}});

test('buildApp OAuth SDK to MCP preserves origin/cookie/CSRF boundary and keeps public REST PAT-only',async()=>{
 const {createServer}=await import('node:net');const {buildApp}=await import('../../server/app.js');const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const {StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
 const origin='http://127.0.0.1:'+port,db=await createTestDatabase(),server=buildApp({db,origin}),client=new Client({name:'oauth-integrated-acceptance',version:'1'});
 try{
  const web=new AuthService(db);await web.bootstrapAdmin('oauth-integration',password);
  await server.listen({host:'127.0.0.1',port});
  const login=await fetch(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'oauth-integration',password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0],credentials=await login.json();
  const webActor=await web.authenticate(cookie.split('=')[1]),projects=new ProjectService(db),own=await projects.create(webActor,{title:'OAuth shared PostgreSQL'}),outside=await projects.create(webActor,{title:'Outside OAuth grant'});
  let registration:OAuthClientInformationMixed|undefined,tokens:OAuthTokens|undefined,verifier='',authorization:URL|undefined;
  const provider:OAuthClientProvider={redirectUrl:'http://127.0.0.1:43124/callback',clientMetadata:{client_name:'Integrated SDK client',redirect_uris:['http://127.0.0.1:43124/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code']},state:()=> 'integration-state',clientInformation:()=>registration,saveClientInformation:v=>{registration=v;},tokens:()=>tokens,saveTokens:v=>{tokens=v;},saveCodeVerifier:v=>{verifier=v;},codeVerifier:()=>verifier,redirectToAuthorization:v=>{authorization=v;}};
  const prm=await fetch(origin+'/.well-known/oauth-protected-resource/mcp').then(r=>r.json());assert.equal(prm.resource,origin+'/mcp');assert.deepEqual(prm.authorization_servers,[origin]);
  assert.equal(await sdkAuth(provider,{serverUrl:origin+'/mcp',scope:'projects:read projects:write themes:read'}),'REDIRECT');assert.ok(authorization);const started=await fetch(authorization,{redirect:'manual'});assert.equal(started.status,302);const consentUrl=new URL(started.headers.get('location')!),request=consentUrl.searchParams.get('request')!;
  assert.equal((await fetch(consentUrl)).status,200);
  const approve=(headers:Record<string,string>)=>fetch(origin+'/oauth/consent',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,...headers},body:JSON.stringify({request,approve:true,projectAllowlist:[own.id]})});
  assert.equal((await approve({Origin:'https://evil.invalid','X-CSRF-Token':credentials.csrfToken})).status,403);
  assert.equal((await approve({Origin:origin})).status,403);
  assert.equal((await approve({Origin:origin,'X-CSRF-Token':credentials.csrfToken,'X-SP-Account-ID':'different-account'})).status,403);
  const accepted=await approve({Origin:origin,'X-CSRF-Token':credentials.csrfToken,'X-SP-Account-ID':credentials.user.id});assert.equal(accepted.status,200);const redirect=new URL((await accepted.json()).redirect);assert.equal(redirect.searchParams.get('state'),'integration-state');
  assert.equal(await sdkAuth(provider,{serverUrl:origin+'/mcp',authorizationCode:redirect.searchParams.get('code')!}),'AUTHORIZED');assert.ok(tokens);assert.ok(registration);
  const rest=await fetch(origin+'/api/v1/projects',{headers:{Authorization:'Bearer '+tokens.access_token}});assert.equal(rest.status,401);
  const forged=await fetch(origin+'/api/v1/projects',{headers:{Authorization:'Bearer '+tokens.access_token,'X-SP-MCP-Relay':'invented'}});assert.equal(forged.status,401);
  const message={jsonrpc:'2.0',id:7,method:'tools/list',params:{}};
  const accessToken=tokens.access_token;const mcp=(extra:Record<string,string>={})=>fetch(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:'Bearer '+accessToken,...extra},body:JSON.stringify(message)});
  assert.equal((await mcp({Cookie:cookie})).status,401);assert.equal((await mcp({Origin:'https://evil.invalid'})).status,403);const {request:rawRequest}=await import('node:http');const wrongHost=await new Promise<number>((resolve,reject)=>{const req=rawRequest(origin+'/mcp',{method:'POST',headers:{Host:'evil.invalid','Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:'Bearer '+accessToken}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});req.on('error',reject);req.end(JSON.stringify(message));});assert.equal(wrongHost,403);
  await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+tokens.access_token}}}));assert.equal((await client.listTools()).tools.length,22);
  const call=async(name:string,args:Record<string,unknown>)=>{const result=await client.callTool({name,arguments:args});return JSON.parse((result.content as {text:string}[])[0].text);};
  assert.equal((await call('sp_get_document',{projectId:own.id,full:true})).title,own.title);
  assert.equal((await call('sp_get_document',{projectId:outside.id})).error.code,'FORBIDDEN');
  const builtin=(await call('sp_list_themes',{}))[0],themeInput={themeId:builtin.id,version:builtin.version,hash:builtin.hash};
  assert.equal((await call('sp_preview_theme_application',{projectId:own.id,...themeInput,expectedRevision:0})).revision,0);
  assert.equal((await call('sp_validate_theme_compatibility',{projectId:own.id})).revision,0);
  assert.equal((await call('sp_preview_theme_application',{projectId:outside.id,...themeInput})).error.code,'FORBIDDEN');
  assert.equal((await call('sp_validate_theme_compatibility',{projectId:outside.id})).error.code,'FORBIDDEN');

  const edited=await call('sp_edit',{projectId:own.id,expectedRevision:0,clientMutationId:'oauth-integrated-edit',operations:[{type:'updateProject',properties:{title:'OAuth changed same cloud document'}}]});assert.equal(edited.revision,1);assert.equal((await projects.get(webActor,own.id)).title,'OAuth changed same cloud document');
  assert.equal((await call('sp_create_project',{title:'Scope denied'})).error.code,'FORBIDDEN');
  const cookieRevocation=await fetch(origin+'/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:cookie,Origin:origin},body:new URLSearchParams({client_id:registration.client_id,token:tokens.access_token})});assert.equal(cookieRevocation.status,400);
  assert.equal((await post(origin,'/revoke',{client_id:registration.client_id,token:tokens.access_token})).status,200);const revoked=await mcp();assert.equal(revoked.status,401);assert.equal(revoked.headers.get('www-authenticate'),`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`);
 }finally{await client.close();await server.close();await cleanupTestDatabase(db);}
});
