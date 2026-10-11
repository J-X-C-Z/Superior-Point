import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {migrate} from '../../server/db/migrate.js';
const schemas = new WeakMap<pg.Pool,string>();
export async function createTestDatabase() {
 const connectionString=process.env.TEST_DATABASE_URL;
 if(!connectionString) throw Error('TEST_DATABASE_URL must point to a disposable local PostgreSQL cluster');
 const url=new URL(connectionString);
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.pathname !== '/sp_foundation_test') throw Error('Service tests require loopback database sp_foundation_test');
 const schema='sp_test_'+randomUUID().replaceAll('-','');
 const admin=new pg.Pool({connectionString});
 try {await admin.query(`CREATE SCHEMA "${schema}"`);} finally {await admin.end();}
 const db=new pg.Pool({connectionString,options:`-c search_path=${schema},public`,max:10});schemas.set(db,schema);
 try {await migrate(db);} catch(error){await cleanupTestDatabase(db);throw error;}
 return db;
}
export async function cleanupTestDatabase(db: pg.Pool) {
 const schema=schemas.get(db);
 if(!schema || !/^sp_test_[a-f0-9]+$/.test(schema)) throw Error('Unknown test schema');
 try {await db.query(`DROP SCHEMA "${schema}" CASCADE`);} finally {schemas.delete(db);await db.end();}
}
