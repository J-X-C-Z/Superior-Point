import test from 'node:test';
import assert from 'node:assert/strict';
import {migrate,rollbackTestSchema} from '../../server/db/migrate.js';
import {createTestDatabase,cleanupTestDatabase} from './helpers.js';

test('real PostgreSQL migration replay, checksum drift refusal, rollback and rebuild',async()=>{
 const db=await createTestDatabase();
 try{
  await Promise.all([migrate(db),migrate(db)]);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0].count,4);
  await db.query("UPDATE schema_migrations SET checksum='tampered'");
  await assert.rejects(migrate(db),/checksum mismatch/);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='projects'")).rows[0].count,1);
  await rollbackTestSchema(db);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0].count,0);
  await migrate(db);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM users')).rows[0].count,0);
 }finally{await cleanupTestDatabase(db);}
});

test('PostgreSQL transaction failure does not leave partial schema/data',async()=>{
 const db=await createTestDatabase();
 try{
  const client=await db.connect();
  try{await client.query('BEGIN');await client.query('CREATE TABLE partial_migration(id integer)');await assert.rejects(client.query('SELECT * FROM table_that_does_not_exist'));await client.query('ROLLBACK');}
  finally{client.release();}
  assert.equal((await db.query("SELECT to_regclass('partial_migration') AS value")).rows[0].value,null);
  const admin=new (await import('pg')).default.Pool({connectionString:process.env.TEST_DATABASE_URL});
  try{await assert.rejects(rollbackTestSchema(admin),/restricted/);}finally{await admin.end();}
 }finally{await cleanupTestDatabase(db);}
});
