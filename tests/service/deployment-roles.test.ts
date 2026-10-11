import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {migrate} from '../../server/db/migrate.js';
import {AuthService} from '../../server/auth/auth-service.js';
import {ProjectService} from '../../server/services/project-service.js';
import {BackupService} from '../../server/services/backup-service.js';

test('deployment roles: actual initializer, independent migrations, app DML without DDL, and non-superuser public-schema backup restore',async()=>{
 const input=process.env.TEST_DATABASE_URL,bin=process.env.SP_TEST_PG_BIN;
 if(!input||!bin)throw Error('TEST_DATABASE_URL and SP_TEST_PG_BIN are required for real deployment-role acceptance');
 const base=new URL(input);
 if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname)||base.pathname!=='/sp_foundation_test')throw Error('Deployment-role tests require loopback sp_foundation_test control database');
 const suffix=randomUUID().replaceAll('-',''),database='sp_roles_'+suffix,roles=['app','migrator','restore'].map(name=>'sp_roles_'+name+'_'+suffix),passwords=roles.map(()=>randomBytes(32).toString('hex'));
 const control=new pg.Client({connectionString:input});await control.connect();let created=false;
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'sp-role-backup-'))),pools:pg.Pool[]=[];
 const urlFor=(index:number)=>{const value=new URL(base);value.pathname='/'+database;value.username=roles[index];value.password=passwords[index];value.searchParams.delete('options');return value.toString();};
 try{
  assert.match(database,/^sp_roles_[a-f0-9]{32}$/);await control.query(`CREATE DATABASE "${database}"`);created=true;
  await new Promise<void>((resolve,reject)=>{
   const child=spawn('sh',[path.resolve('deploy/hakari/initdb/01-app-roles.sh')],{env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,PGHOST:base.hostname,PGPORT:base.port||'5432',PGPASSWORD:decodeURIComponent(base.password),POSTGRES_USER:decodeURIComponent(base.username),POSTGRES_DB:database,SP_APP_DB_USER:roles[0],SP_APP_DB_PASSWORD:passwords[0],SP_MIGRATOR_DB_USER:roles[1],SP_MIGRATOR_DB_PASSWORD:passwords[1],SP_RESTORE_DB_USER:roles[2],SP_RESTORE_DB_PASSWORD:passwords[2]},stdio:'ignore'});
   child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Deployment role initializer failed')));
  });
  const application=new pg.Pool({connectionString:urlFor(0)}),migrator=new pg.Pool({connectionString:urlFor(1)});pools.push(application,migrator);await migrate(migrator);
  assert.equal((await application.query('SELECT current_schema() AS name')).rows[0].name,'public');
  await assert.rejects(application.query('CREATE TABLE public.app_must_not_create_table(id integer)'),{code:'42501'});
  await assert.rejects(application.query('ALTER TABLE public.projects ADD COLUMN app_must_not_alter integer'),{code:'42501'});
  const privileges=(await control.query('SELECT rolname,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=ANY($1::text[])',[roles])).rows;
  assert.equal(privileges.length,3);assert.ok(privileges.every(row=>!row.rolsuper&&!row.rolcreaterole));assert.equal(privileges.find(row=>row.rolname===roles[0]).rolcreatedb,false);assert.equal(privileges.find(row=>row.rolname===roles[2]).rolcreatedb,true);
  const auth=new AuthService(application),password='isolated-role-application-password';await auth.bootstrapAdmin('roleadmin',password);const login=await auth.login('roleadmin',password),actor=await auth.authenticate(login.sessionToken),projects=new ProjectService(application),document=await projects.create(actor,{title:'Role-protected document'});
  await projects.edit(actor,document.id,{expectedRevision:0,clientMutationId:'role-edit',operations:[{type:'updateProject',properties:{extensions:{unknownData:{preserved:[1,'x']}}}}]});
  const source=path.join(root,'assets');await mkdir(source);await writeFile(path.join(source,'asset.bin'),Buffer.from([1,2,3,4]));
  const backup=new BackupService(application,{directory:path.join(root,'backups'),assetDirectory:source,databaseUrl:urlFor(0),restoreDatabaseUrl:urlFor(2),pgBinDirectory:bin});
  await backup.start(actor);await backup.waitForIdle();const result=await backup.list(actor);assert.equal(result.jobs[0].status,'verified',JSON.stringify(result));const check=await backup.restoreChecks(actor);assert.equal(check.projectCount,1);assert.equal(check.assetCount,1);
  assert.deepEqual((await projects.get(actor,document.id)).extensions,{unknownData:{preserved:[1,'x']}});
 }finally{
  await Promise.all(pools.map(async pool=>{
   // pg-pool end() resolves before client sockets close; wait for their remove events before dropping the database.
   const disconnected=new Promise<void>(resolve=>{let remaining=pool.totalCount;if(!remaining)resolve();else pool.on('remove',()=>{if(--remaining===0)resolve();});});
   await pool.end();await disconnected;
  }));if(created)await control.query(`DROP DATABASE "${database}"`);
  for(const role of roles){assert.match(role,/^sp_roles_(app|migrator|restore)_[a-f0-9]{32}$/);await control.query(`DROP ROLE IF EXISTS "${role}"`);}
  await control.end();await rm(root,{recursive:true,force:true});
 }
});
