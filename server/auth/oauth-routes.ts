import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {authorizationHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import {tokenHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import {clientRegistrationHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import {revocationHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import {OAuthError} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {OAuthService,oauthScopes} from './oauth-service.js';
import type {AuthService} from './auth-service.js';
import {errors,type Actor,type Database} from '../contracts.js';
// SDK handlers use Express; the bridge preserves their validation and rate limits.
const express=createRequire(import.meta.url)('express');
export function registerOAuthRoutes(app:FastifyInstance,options:{db:Database;origin:string;auth:AuthService;actor:(request:FastifyRequest)=>Promise<Actor>;service?:OAuthService}) {
 const service=options.service??new OAuthService(options.db,options.origin);const origin=options.origin;
 const metadata={issuer:origin,authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',registration_endpoint:origin+'/register',revocation_endpoint:origin+'/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none'],scopes_supported:oauthScopes};
 const resource={resource:service.resource,authorization_servers:[origin],scopes_supported:oauthScopes,bearer_methods_supported:['header'],resource_name:'Superior Point MCP'};
 app.get('/.well-known/oauth-authorization-server',async(_req,reply)=>reply.header('Access-Control-Allow-Origin','*').send(metadata));
 for(const path of ['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'])app.get(path,async(_req,reply)=>reply.header('Access-Control-Allow-Origin','*').send(resource));
 if(!app.hasContentTypeParser('application/x-www-form-urlencoded'))app.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string'},(_request,body,done)=>{const params=new URLSearchParams(String(body));const result:Record<string,string>={};for(const [key,value] of params){if(key in result){done(errors.invalid(),undefined);return;}result[key]=value;}done(null,result);});
 const sdk=express();sdk.disable('x-powered-by');
 sdk.use('/authorize',authorizationHandler({provider:service}));sdk.use('/token',tokenHandler({provider:service}));sdk.use('/register',clientRegistrationHandler({clientsStore:service.clientsStore}));sdk.use('/revoke',revocationHandler({provider:service}));
 for(const path of ['/authorize','/token','/register','/revoke'])app.route({url:path,method:['GET','POST','OPTIONS'],bodyLimit:16*1024,handler:async(request,reply)=>{if(request.headers.cookie&&path!=='/authorize')return reply.code(400).send({error:'invalid_request'});if(path==='/token'&&(request.body as any)?.grant_type==='authorization_code'&&!/^[A-Za-z0-9._~-]{43,128}$/.test((request.body as any)?.code_verifier??''))return reply.code(400).send({error:'invalid_grant'});Object.assign(request.raw,{body:request.body});reply.hijack();for(const [key,value] of Object.entries(reply.getHeaders()))if(value!==undefined)reply.raw.setHeader(key,value);sdk(request.raw,reply.raw);}});
 const safe=async<T>(reply:any,work:()=>Promise<T>)=>{try{return await work();}catch(error){if(error instanceof OAuthError)return reply.code(400).send(error.toResponseObject());throw error;}};
 app.get('/oauth/consent',async(_request,reply)=>reply.type('text/html').send(await readFile(new URL('../../web/oauth-consent.html',import.meta.url),'utf8')));
 for(const [file,type] of [['oauth-consent.js','text/javascript'],['oauth-consent.css','text/css']])app.get('/oauth/'+file,async(_request,reply)=>reply.type(type).send(await readFile(new URL('../../web/'+file,import.meta.url),'utf8')));
 app.get('/oauth/consent/details',async(request,reply)=>safe(reply,()=>service.consent((request.query as {request:string}).request)));
 app.post('/oauth/consent',async(request,reply)=>safe(reply,async()=>{const actor=await options.actor(request);if(actor.source!=='web')throw errors.forbidden();const csrf=request.headers['x-csrf-token'];if(typeof csrf!=='string')throw errors.forbidden();await options.auth.verifyCsrf(actor,csrf);const input=request.body as {request:string;projectAllowlist:string[]|null;approve:boolean};if(!input||typeof input.approve!=='boolean')throw errors.invalid();return {redirect:await service.approve(actor,input.request,input.projectAllowlist,input.approve)};}));
 return service;
}
