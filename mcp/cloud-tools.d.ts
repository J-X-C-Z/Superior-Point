import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
export function registerCloudTools(server:McpServer,options:{request:(method:string,route:string,payload?:unknown,options?:{retry?:boolean})=>Promise<any>;files?:any;redact?:(value:unknown)=>string;onToolCall?:(call:{tool:string;durationMs:number;outcome:"success"|"error";errorCode?:string})=>Promise<unknown>}):void;
