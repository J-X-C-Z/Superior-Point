import {createHash, randomBytes, randomUUID} from 'node:crypto';
import type {OAuthServerProvider, AuthorizationParams} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type {OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest} from '@modelcontextprotocol/sdk/shared/auth.js';
import {InvalidClientMetadataError, InvalidGrantError, InvalidRequestError, InvalidScopeError, UnsupportedGrantTypeError, TooManyRequestsError} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {transaction, errors, type Database, type Actor, type Transaction} from '../contracts.js';
export const oauthScopes = ['projects:read','projects:create','projects:write','projects:delete','projects:export','assets:write','themes:read','themes:write','themes:publish'];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
type Params = Omit<AuthorizationParams,'resource'> & {resource: string; scopes: string[]};
function redirects(uri: string) {try {const u=new URL(uri);return !u.hash&&!u.username&&!u.password&&(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(u.hostname)));} catch {return false;}}
export class OAuthService implements OAuthServerProvider {
 readonly resource: string;
 readonly clientsStore;
 constructor(private readonly db: Database, readonly origin: string) {
  const url=new URL(origin);if(url.origin!==origin||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw Error('Exact HTTPS or loopback origin required');
  this.resource=origin+'/mcp';
  this.clientsStore={getClient:async(id:string):Promise<OAuthClientInformationFull|undefined>=>{if(id.length>256)return undefined;return (await db.query('SELECT metadata FROM oauth_clients WHERE id=$1',[id])).rows[0]?.metadata;},registerClient:async(input:Omit<OAuthClientInformationFull,'client_id'|'client_id_issued_at'>):Promise<OAuthClientInformationFull>=>{
   if(input.token_endpoint_auth_method!=='none'||input.client_secret||!input.redirect_uris.length||input.redirect_uris.length>5||input.redirect_uris.some(uri=>uri.length>2048||!redirects(uri))||input.grant_types?.some(g=>g!=='authorization_code')||input.response_types?.some(r=>r!=='code'))throw new InvalidClientMetadataError('Public authorization-code clients only');
   const client:OAuthClientInformationFull={client_id:randomUUID(),client_id_issued_at:Math.floor(Date.now()/1000),client_name:input.client_name?.slice(0,128)||'MCP client',redirect_uris:input.redirect_uris,token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code']};
   return transaction(db,async tx=>{await tx.query('SELECT pg_advisory_xact_lock(735077001)');if((await tx.query('SELECT count(*)::int AS n FROM oauth_clients')).rows[0].n>=1000)throw new TooManyRequestsError('Client registry is full');await tx.query('INSERT INTO oauth_clients(id,metadata) VALUES($1,$2)',[client.client_id,JSON.stringify(client)]);return client;});
  }};
 }
 async authorize(client:OAuthClientInformationFull,params:AuthorizationParams,res:Parameters<OAuthServerProvider['authorize']>[2]) {
  if(!client.redirect_uris.includes(params.redirectUri)||!redirects(params.redirectUri)||params.resource?.href!==this.resource||! /^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)|| (params.state?.length??0)>2048)throw new InvalidRequestError('Exact redirect, MCP resource and S256 challenge required');
  const scopes=params.scopes?.length?params.scopes:['projects:read'];
  if(scopes.some(s=>!oauthScopes.includes(s))||new Set(scopes).size!==scopes.length)throw new InvalidScopeError('Unsupported scope');
  const id=opaque();await transaction(this.db,async tx=>{await tx.query('SELECT pg_advisory_xact_lock(735077002)');await tx.query('DELETE FROM oauth_requests WHERE expires_at<=clock_timestamp()');await tx.query('DELETE FROM oauth_codes WHERE expires_at<=clock_timestamp()');if((await tx.query('SELECT count(*)::int AS n FROM oauth_requests')).rows[0].n>=10000)throw new TooManyRequestsError('Authorization capacity exceeded');await tx.query('INSERT INTO oauth_requests(id,client_id,params) VALUES($1,$2,$3)',[id,client.client_id,JSON.stringify({...params,scopes,resource:this.resource})]);});
  res.redirect(302,this.origin+'/oauth/consent?request='+id);
 }
 async consent(id:string) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(id))throw new InvalidRequestError('Invalid authorization request');
  const row=(await this.db.query('SELECT r.params,c.metadata FROM oauth_requests r JOIN oauth_clients c ON c.id=r.client_id WHERE r.id=$1 AND r.expires_at>clock_timestamp()',[id])).rows[0];
  if(!row)throw new InvalidRequestError('Authorization request expired');return {client:row.metadata.client_name,redirectUri:row.params.redirectUri,scopes:row.params.scopes,resource:this.resource};
 }
 private async active(tx:Transaction,actor:Actor) {
  if(actor.source!=='web'||!actor.sessionId)throw errors.forbidden();
  if(!(await tx.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR SHARE",[actor.id])).rowCount||!(await tx.query('SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',[actor.sessionId,actor.id])).rowCount)throw errors.unauthorized();
 }
 async approve(actor:Actor,id:string,allowlist:string[]|null,approve:boolean) {
  await this.consent(id);
  if(allowlist!==null&&(!Array.isArray(allowlist)||allowlist.length>1000||allowlist.some(v=>typeof v!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v))||new Set(allowlist).size!==allowlist.length))throw errors.invalid();
  return transaction(this.db,async tx=>{await this.active(tx,actor);const row=(await tx.query('DELETE FROM oauth_requests WHERE id=$1 AND expires_at>clock_timestamp() RETURNING *',[id])).rows[0];if(!row)throw new InvalidRequestError('Authorization request expired');const p:Params=row.params;const target=new URL(p.redirectUri);if(p.state!==undefined)target.searchParams.set('state',p.state);if(!approve){target.searchParams.set('error','access_denied');return target.href;}
   if(allowlist!==null){const owned=await tx.query('SELECT id FROM projects WHERE owner_id=$1 AND id=ANY($2::uuid[])',[actor.id,allowlist]);if(owned.rowCount!==allowlist.length)throw errors.forbidden();}
   const code=opaque();await tx.query('INSERT INTO oauth_codes(code_hash,client_id,user_id,params,project_allowlist) VALUES($1,$2,$3,$4,$5)',[hash(code),row.client_id,actor.id,JSON.stringify(p),JSON.stringify(allowlist)]);target.searchParams.set('code',code);return target.href;
  });
 }
 async challengeForAuthorizationCode(client:OAuthClientInformationFull,code:string) {if(!/^[A-Za-z0-9_-]{43}$/.test(code))throw new InvalidGrantError('Invalid code');const row=(await this.db.query('SELECT params FROM oauth_codes WHERE code_hash=$1 AND client_id=$2 AND expires_at>clock_timestamp()',[hash(code),client.client_id])).rows[0];if(!row)throw new InvalidGrantError('Invalid code');return row.params.codeChallenge;}
 async exchangeAuthorizationCode(client:OAuthClientInformationFull,code:string,_verifier?:string,redirectUri?:string,resource?:URL):Promise<OAuthTokens> {
  return transaction(this.db,async tx=>{const lookup=(await tx.query('SELECT user_id FROM oauth_codes WHERE code_hash=$1',[hash(code)])).rows[0];if(!lookup)throw new InvalidGrantError('Invalid code');if(!(await tx.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR SHARE",[lookup.user_id])).rowCount)throw new InvalidGrantError('Invalid user');const row=(await tx.query('DELETE FROM oauth_codes WHERE code_hash=$1 AND client_id=$2 AND expires_at>clock_timestamp() RETURNING *',[hash(code),client.client_id])).rows[0];if(!row||redirectUri!==row.params.redirectUri||resource?.href!==this.resource||row.params.resource!==this.resource)throw new InvalidGrantError('Invalid grant binding');
   const token='sp_oauth_'+opaque();const issued=(await tx.query("INSERT INTO api_tokens(user_id,token_hash,prefix,name,scopes,project_allowlist,expires_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '1 hour') RETURNING id",[row.user_id,hash(token),token.slice(0,17),'OAuth: '+client.client_name,JSON.stringify(row.params.scopes),JSON.stringify(row.project_allowlist)])).rows[0];await tx.query('INSERT INTO oauth_access_tokens(token_id,client_id,resource) VALUES($1,$2,$3)',[issued.id,client.client_id,this.resource]);await tx.query("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,outcome) VALUES($1,'oauth.token_issue','token',$2,'success')",[row.user_id,issued.id]);return {access_token:token,token_type:'Bearer',expires_in:3600,scope:row.params.scopes.join(' ')};
  });
 }
 async exchangeRefreshToken():Promise<OAuthTokens>{throw new UnsupportedGrantTypeError('Refresh tokens are not supported');}
 async authenticate(token:string):Promise<Actor> {
  if(!/^sp_oauth_[A-Za-z0-9_-]{43}$/.test(token))throw errors.unauthorized();
  return transaction(this.db,async tx=>{const lookup=(await tx.query('SELECT user_id FROM api_tokens WHERE token_hash=$1',[hash(token)])).rows[0];if(!lookup)throw errors.unauthorized();const user=(await tx.query("SELECT role FROM users WHERE id=$1 AND status='active' FOR SHARE",[lookup.user_id])).rows[0];if(!user)throw errors.unauthorized();const row=(await tx.query('SELECT t.* FROM api_tokens t JOIN oauth_access_tokens o ON o.token_id=t.id WHERE t.token_hash=$1 AND o.resource=$2 AND t.revoked_at IS NULL AND t.expires_at>clock_timestamp() FOR UPDATE OF t',[hash(token),this.resource])).rows[0];if(!row)throw errors.unauthorized();await tx.query('UPDATE api_tokens SET last_used_at=clock_timestamp() WHERE id=$1',[row.id]);return {id:row.user_id,role:user.role,source:'mcp',tokenId:row.id,scopes:row.scopes,projectAllowlist:row.project_allowlist};});
 }
 async verifyAccessToken(token:string){const actor=await this.authenticate(token);const row=(await this.db.query('SELECT o.client_id,t.expires_at FROM oauth_access_tokens o JOIN api_tokens t ON t.id=o.token_id WHERE t.id=$1',[actor.tokenId])).rows[0];return {token,clientId:row.client_id,scopes:actor.scopes!,expiresAt:Math.floor(row.expires_at.getTime()/1000),resource:new URL(this.resource)};}
 async revokeToken(client:OAuthClientInformationFull,request:OAuthTokenRevocationRequest){if(request.token.length>256)return;await this.db.query('UPDATE api_tokens t SET revoked_at=COALESCE(t.revoked_at,clock_timestamp()) FROM oauth_access_tokens o WHERE o.token_id=t.id AND o.client_id=$1 AND t.token_hash=$2',[client.client_id,hash(request.token)]);}
}
