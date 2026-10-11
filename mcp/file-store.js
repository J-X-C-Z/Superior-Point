import {mkdir,realpath,open,rename,unlink,lstat,rmdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {CoreError,importDocument,DocumentCore} from '../core/document-core.js';
const bad=(code,message)=>{throw new CoreError(code,message);};
export class FileStore {
  constructor(root){if(!root)bad('ROOT_REQUIRED','Explicit project root required');this.root=path.resolve(root);}
  async init(){await mkdir(this.root,{recursive:true});this.root=await realpath(this.root);return this;}
  name(value){if(typeof value!=='string'||!value.match(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)||value.includes('..'))bad('OUT_OF_SCOPE','Only simple filenames/IDs within project root are allowed');return path.join(this.root,value);}
  async readFile(name){const p=this.name(name);const handle=await open(p,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await handle.stat();if(!stat.isFile()||stat.size>32*1024*1024)bad('INVALID_FILE','Expected regular file no larger than 32 MiB');return await handle.readFile('utf8');}finally{await handle.close();}}
  async read(id){const doc=importDocument(await this.readFile(`${id}.json`));if(doc.id!==id)bad('ID_MISMATCH','Stored document ID does not match its filename');return doc;}
  async lock(id,fn){const p=this.name(`${id}.lock`);try{await mkdir(p);}catch(e){if(e.code==='EEXIST')bad('PROJECT_BUSY','Project locked by another process; retry. After a crashed writer, inspect then remove its .lock directory manually.');throw e;}try{return await fn();}finally{await rmdir(p);}}
  async atomic(name,text){if(Buffer.byteLength(text)>32*1024*1024)bad('INVALID_FILE','Output exceeds 32 MiB file limit');const dest=this.name(name),temp=this.name(`tmp-${randomUUID()}`);try{const st=await lstat(dest);if(!st.isFile()||st.isSymbolicLink())bad('OUT_OF_SCOPE','Destination must be a regular non-symlink file');}catch(e){if(e.code!=='ENOENT')throw e;}
    const h=await open(temp,'wx',0o600);try{await h.writeFile(text);await h.sync();}finally{await h.close();}
    try{await rename(temp,dest);const dir=await open(this.root,constants.O_RDONLY);try{await dir.sync();}finally{await dir.close();}}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }
  async create(doc){doc=importDocument(doc);return this.lock(doc.id,async()=>{try{await lstat(this.name(`${doc.id}.json`));bad('ALREADY_EXISTS','Project already exists');}catch(e){if(e.code!=='ENOENT')throw e;}await this.atomic(`${doc.id}.json`,JSON.stringify(doc));return doc;});}
  async edit(id,operations,expectedRevision){if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)bad('REVISION_REQUIRED','expectedRevision required');return this.lock(id,async()=>{const core=new DocumentCore(await this.read(id));const doc=core.edit(operations,{expectedRevision});await this.atomic(`${id}.json`,JSON.stringify(doc));return doc;});}
  async export(id,filename,expectedRevision,exporter){if(!filename.endsWith('.html'))bad('INVALID_FILENAME','Export filename must end with .html');return this.lock(id,async()=>{const doc=await this.read(id);if(expectedRevision!==doc.revision)bad('REVISION_CONFLICT','Document revision changed');const html=await exporter(doc);await this.atomic(filename,html);return {projectId:id,revision:doc.revision,filename,bytes:Buffer.byteLength(html)};});}
}
