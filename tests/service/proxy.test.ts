import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {buildApp} from '../../server/app.js';
import {AuthService} from '../../server/auth/auth-service.js';
import {ServiceError} from '../../server/contracts.js';

for(const trustProxyHops of [undefined,0,1])test('login rate limit with proxy hops '+trustProxyHops,async t=>{
 const db=new pg.Pool(),origin='https://sp.jxcz.top';
 t.mock.method(AuthService.prototype,'login',async()=>{throw new ServiceError('INVALID_CREDENTIALS',401,'Invalid credentials');});
 const app=buildApp({db,origin,secureCookies:true,loginLimit:2,trustProxyHops});
 const login=async(address:string)=>(await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'172.20.0.5',headers:{origin,'x-forwarded-for':address},payload:{username:'proxytest',password:'isolated-test-password'}})).statusCode;
 try{
  assert.equal(await login('198.51.100.1'),401);
  assert.equal(await login('198.51.100.1'),401);
  assert.equal(await login('198.51.100.1'),429);
  assert.equal(await login('198.51.100.2'),trustProxyHops===1?401:429);
  assert.equal(await login('203.0.113.9, 198.51.100.1'),429);
 }finally{await app.close();await db.end();}
});

test('only zero or one trusted proxy hop is supported',async()=>{
 const db=new pg.Pool();
 try{for(const trustProxyHops of [-1,2,NaN])assert.throws(()=>buildApp({db,origin:'https://sp.jxcz.top',secureCookies:true,trustProxyHops}),/zero or one proxy hop/);}
 finally{await db.end();}
});
