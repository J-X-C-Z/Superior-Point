import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Actor} from '../contracts.js';
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
export function registerStaticRoutes(app:FastifyInstance,actor:(request:FastifyRequest)=>Promise<Actor>){
 app.get('/favicon.ico',async(_,reply)=>reply.code(204).send());
 app.get('/',async(_,reply)=>reply.redirect('/app'));
 app.get('/login',async(_,reply)=>reply.redirect('/app?login=1'));
 app.get('/local',async(_,reply)=>reply.redirect('/web/'));
 app.get('/app',async(_,reply)=>reply.type('text/html; charset=utf-8').send((await readFile(path.join(root,'web/index.html'),'utf8')).replace('href="./style.css"','href="/web/style.css"').replace('src="./entry.js"','src="/web/entry.js"')));
 app.get('/admin',async(request,reply)=>{try{const current=await actor(request);if(current.role!=='admin'||current.source!=='web')return reply.code(403).type('text/html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>访问受限</title><p>仅管理员可访问管理后台。</p><a href="/app">返回工作台</a></html>');}catch{return reply.redirect('/login');}return reply.type('text/html; charset=utf-8').send(await readFile(path.join(root,'web/admin/index.html')));});
 for(const directory of ['web','storage','core','vendor','io','adapters','examples'])app.get('/'+directory+'/*',async(request,reply)=>{
  const relative=decodeURIComponent(request.url.split('?')[0]).slice(1);
  if(relative.split('/').some(segment=>segment==='..'||segment==='.')||relative.includes('\\')||relative.includes('\0'))return reply.code(404).send({error:{code:'NOT_FOUND',message:'资源不存在'}});
  if(relative.startsWith('web/admin/')&&(relative.endsWith('.html')||relative.endsWith('/'))){try{const current=await actor(request);if(current.role!=='admin'||current.source!=='web')return reply.code(403).send({error:{code:'FORBIDDEN',message:'无权访问后台'}});}catch{return reply.redirect('/login');}}
  const target=path.join(root,relative)+(relative.endsWith('/')?'index.html':'');
  let actual:string;try{actual=await realpath(target);}catch{return reply.code(404).send({error:{code:'NOT_FOUND',message:'资源不存在'}});}
  if(!actual.startsWith(root+path.sep))return reply.code(404).send({error:{code:'NOT_FOUND',message:'资源不存在'}});
  return reply.type(types[path.extname(actual)]??'application/octet-stream').send(await readFile(actual));
 });
}
