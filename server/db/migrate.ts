import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {transaction, type Database} from '../contracts.js';
const directory = new URL('./migrations/', import.meta.url);
export async function migrate(db: Database) {
 return transaction(db, async client => {
  await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':sp-migrations'))");
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = (await readdir(directory)).filter(f => /^\d+_[\w-]+\.sql$/.test(f)).sort();
  for (const version of files) {
   const sql = await readFile(new URL(version,directory),'utf8');
   const checksum = createHash('sha256').update(sql).digest('hex');
   const old = await client.query('SELECT checksum FROM schema_migrations WHERE version=$1',[version]);
   if (old.rowCount) {if(old.rows[0].checksum!==checksum) throw Error('Applied migration checksum mismatch: '+version); continue;}
   await client.query(sql);
   await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[version,checksum]);
  }
 });
}
export async function rollbackTestSchema(db: Database) {
 return transaction(db, async client => {
  const schema=(await client.query('SELECT current_schema() AS name')).rows[0].name;
  if(!/^sp_test_[a-f0-9]+$/.test(schema)) throw Error('Rollback restricted to isolated sp_test_ schemas');
  await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':sp-migrations'))");
  const {rows}=await client.query('SELECT version FROM schema_migrations ORDER BY version DESC');
  for (const {version} of rows) {
   if(!/^\d+_[\w-]+\.sql$/.test(version)) throw Error('Invalid migration version');
   await client.query(await readFile(new URL(version.replace(/\.sql$/,'.down.sql'),directory),'utf8'));
   await client.query('DELETE FROM schema_migrations WHERE version=$1',[version]);
  }
 });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
 const db = new pg.Pool({connectionString:process.env.DATABASE_URL});
 try {await migrate(db); console.log('Database migrations committed');} finally {await db.end();}
}
