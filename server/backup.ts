import pg from 'pg';
import {BackupService} from './services/backup-service.js';
if(!process.env.DATABASE_URL||!process.env.SP_BACKUP_DIR)throw Error('Backup configuration is required');
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
const backup=new BackupService(db,{databaseUrl:process.env.DATABASE_URL,directory:process.env.SP_BACKUP_DIR,assetDirectory:process.env.SP_ASSET_DIR,restoreDatabaseUrl:process.env.SP_RESTORE_DATABASE_URL,pgBinDirectory:process.env.SP_PG_BIN});
try{const job=await backup.startScheduled();await backup.waitForIdle();const result=(await db.query('SELECT id,status,error_code FROM backup_jobs WHERE id=$1',[job.id])).rows[0];if(!['verified','completed'].includes(result.status))throw Error('Backup failed');console.log(JSON.stringify({id:result.id,status:result.status}));}finally{await db.end();}
