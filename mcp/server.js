#!/usr/bin/env node
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {pathToFileURL} from 'node:url';
import {createDocument,validateDocument} from '../core/document-core.js';
import {FileStore} from './file-store.js';
const id=z.string().min(1).max(128), rev=z.number().int().nonnegative();
export async function createServer(root){
 const store=await new FileStore(root).init();
 const server=new McpServer({name:'superior-point',version:'0.0.1'});
 const register=(name,description,inputSchema,fn)=>server.registerTool(name,{description,inputSchema},async(args)=>{try{const result=await fn(args);return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:{result}};}catch(e){return {isError:true,content:[{type:'text',text:JSON.stringify({error:{code:e.code??'ERROR',message:e.message,details:e.details}})}]};}});
 register('sp_create_project','Create durable canonical project in authorized project root.',{projectId:id.optional(),title:z.string().optional(),canvas:z.object({width:z.number().positive(),height:z.number().positive()}).optional()},a=>store.create(createDocument({...a,id:a.projectId})));
 register('sp_open_project','Open stored project by ID, or import a bounded editable HTML filename into a new project.',{projectId:id.optional(),filename:id.optional()},async a=>{if(Boolean(a.projectId)===Boolean(a.filename))throw new Error('Provide exactly projectId or filename');if(a.projectId)return store.read(a.projectId);if(!a.filename.endsWith('.html'))throw new Error('Only editable HTML import supported');const {importHTML}=await import('../io/html.js');return store.create(importHTML(await store.readFile(a.filename)));});
 register('sp_get_document','Read authoritative document (full=true), or summary and revision.',{projectId:id,full:z.boolean().optional()},async a=>{const d=await store.read(a.projectId);return a.full?d:{id:d.id,title:d.title,revision:d.revision,canvas:d.canvas,slides:d.slides.map(s=>({id:s.id,elementCount:s.elements.length})),assetCount:d.assets.length};});
 register('sp_get_slide','Read slide and all canonical editable elements.',{projectId:id,slideId:id},async a=>{const d=await store.read(a.projectId),slide=d.slides.find(s=>s.id===a.slideId);if(!slide)throw new Error('Slide not found');return {projectId:d.id,revision:d.revision,slide};});
 register('sp_edit','Atomically apply operations with mandatory revision compare-and-swap; commit to disk before success.',{projectId:id,expectedRevision:rev,operations:z.array(z.record(z.unknown())).min(1).max(1000)},a=>store.edit(a.projectId,a.operations,a.expectedRevision));
 register('sp_render_slide','Return sanitized static SVG preview. Generic renderer is not final editor fidelity; animation and browser fonts differ.',{projectId:id,slideId:id},async a=>{const {renderSlideSVG,inspectRenderCompatibility}=await import('../io/html.js');const d=await store.read(a.projectId);return {projectId:d.id,revision:d.revision,mimeType:'image/svg+xml',svg:renderSlideSVG(d,a.slideId),renderCompatibility:inspectRenderCompatibility(d),limitations:['Static SVG; no animation playback','Generic renderer pending authoritative editor adapter']};});
 register('sp_validate','Validate saved canonical structure and report geometry warnings.',{projectId:id},async a=>{const doc=await store.read(a.projectId),{inspectRenderCompatibility}=await import('../io/html.js');return {...validateDocument(doc),renderCompatibility:inspectRenderCompatibility(doc)};});
 register('sp_save_export','Export saved revision to a self-contained editable HTML within authorized root.',{projectId:id,expectedRevision:rev,filename:id},async a=>{const {exportHTML}=await import('../io/html.js');return store.export(a.projectId,a.filename,a.expectedRevision,exportHTML);});
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const pos=process.argv.indexOf('--project-root');const root=pos>=0?process.argv[pos+1]:process.env.SP_PROJECT_ROOT;if(!root){console.error('Usage: node mcp/server.js --project-root /absolute/authorized/directory');process.exitCode=1;}else{try{const server=await createServer(root);await server.connect(new StdioServerTransport());}catch(e){console.error(e.message);process.exitCode=1;}}}
