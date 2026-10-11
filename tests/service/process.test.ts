import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {AuthService} from '../../server/auth/auth-service.js';
import {createTestDatabase,cleanupTestDatabase} from './helpers.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
async function freePort(){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as net.AddressInfo).port;await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));return port;}
async function start(database:string,port:number){
 const child=spawn(process.execPath,['--import','tsx','server/start.ts'],{cwd:root,env:{...process.env,DATABASE_URL:database,SP_DEV_HTTP:'1',SP_PORT:String(port),SP_ORIGIN:`http://127.0.0.1:${port}`},stdio:['ignore','pipe','pipe']});
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Service readiness timed out')),10000);let output='';child.stdout!.on('data',chunk=>{output+=chunk.toString();if(output.includes('SP foundation API listening')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Service exited before readiness: '+code));});child.once('error',reject);});
 return child;
}
async function stop(child:ChildProcess){if(child.exitCode!==null)return;const exited=once(child,'exit');child.kill('SIGTERM');const [code]=await exited;assert.equal(code,0);}

test('real HTTP service process restart preserves PostgreSQL document and sessions',async()=>{
 const db=await createTestDatabase();let child:ChildProcess|undefined;
 try{
  const schema=(await db.query('SELECT current_schema() AS name')).rows[0].name;
  const database=new URL(process.env.TEST_DATABASE_URL!);database.searchParams.set('options',`-c search_path=${schema},public`);
  await new AuthService(db).bootstrapAdmin('process-admin','test-only-strong-password');
  const port=await freePort();const origin=`http://127.0.0.1:${port}`;
  child=await start(database.toString(),port);
  const login=await fetch(origin+'/api/v1/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'process-admin',password:'test-only-strong-password'})});assert.equal(login.status,200);
  const session=await login.json() as any;const headers={origin,'content-type':'application/json',cookie:login.headers.get('set-cookie')!.split(';')[0],'x-csrf-token':session.csrfToken};
  const created=await fetch(origin+'/api/v1/projects',{method:'POST',headers,body:JSON.stringify({title:'persisted-process-project'})});assert.equal(created.status,201);const doc=await created.json() as any;
  const response=await fetch(origin+`/api/v1/projects/${doc.id}/document`,{method:'PATCH',headers,body:JSON.stringify({expectedRevision:0,clientMutationId:'process-mutation',operations:[{type:'createSlide',slide:{id:'slide',elements:[{id:'text',type:'text',x:0,y:0,w:100,h:50,text:'survives restart'}]}}]})});assert.equal(response.status,200);
  await stop(child);child=undefined;child=await start(database.toString(),port);
  const read=await fetch(origin+`/api/v1/projects/${doc.id}/document`,{headers});assert.equal(read.status,200);const persisted=await read.json() as any;assert.equal(persisted.revision,1);assert.equal(persisted.slides[0].elements[0].text,'survives restart');
 }finally{if(child)await stop(child);await cleanupTestDatabase(db);}
});

test('bootstrap CLI consumes stdin only, initializes once, and never prints the password',async()=>{
 const db=await createTestDatabase();
 try{
  const schema=(await db.query('SELECT current_schema() AS name')).rows[0].name;
  const database=new URL(process.env.TEST_DATABASE_URL!);database.searchParams.set('options',`-c search_path=${schema},public`);
  const password='stdin-only-acceptance-password';
  async function bootstrap(){const child=spawn(process.execPath,['--import','tsx','server/bootstrap-admin.ts'],{cwd:root,env:{...process.env,DATABASE_URL:database.toString(),SP_BOOTSTRAP_USERNAME:'cli-admin'},stdio:['pipe','pipe','pipe']});let output='';child.stdout!.on('data',c=>output+=c.toString());child.stderr!.on('data',c=>output+=c.toString());child.stdin!.end(password+'\n');const [code]=await once(child,'exit');assert.ok(!output.includes(password),'CLI output must omit password');return {code,output};}
  const first=await bootstrap();assert.equal(first.code,0,first.output);assert.match(first.output,/First administrator created/);
  const second=await bootstrap();assert.notEqual(second.code,0);assert.equal((await db.query('SELECT count(*)::int AS count FROM users')).rows[0].count,1);
  const login=await new AuthService(db).login('cli-admin',password);assert.equal(login.user.role,'admin');
 }finally{await cleanupTestDatabase(db);}
});
