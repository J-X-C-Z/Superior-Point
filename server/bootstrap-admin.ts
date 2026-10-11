import pg from 'pg';
import {AuthService} from './auth/auth-service.js';
if(!process.env.DATABASE_URL || !process.env.SP_BOOTSTRAP_USERNAME) throw Error('DATABASE_URL and SP_BOOTSTRAP_USERNAME are required');
if(process.stdin.isTTY) throw Error('Supply password through stdin from a secure prompt; never as command argument');
let password='';for await(const chunk of process.stdin){password+=chunk.toString();if(password.length>1025)throw Error('Password input too long');}
password=password.replace(/\r?\n$/,'');
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
try {await new AuthService(db).bootstrapAdmin(process.env.SP_BOOTSTRAP_USERNAME,password);console.log('First administrator created');}finally{password='';await db.end();}
