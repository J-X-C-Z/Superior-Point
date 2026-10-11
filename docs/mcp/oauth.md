# Remote MCP OAuth

SP-077 uses the installed MCP SDK authorization, registration, token and revocation handlers. OAuthService supplies PostgreSQL client/grant/token storage. It supports public clients (`token_endpoint_auth_method: none`) with authorization code + PKCE S256 only. No implicit/password/client-credentials grant, refresh token, OIDC or client metadata document fetching is advertised.

The canonical resource is the configured exact service origin plus `/mcp`. Authorization and token exchange must both include that exact `resource`. OAuth access tokens are accepted only by `/mcp`; the HTTPS REST API and local stdio bridge continue using PATs. Gateway-internal calls revalidate their OAuth actor without exposing OAuth authorization on public REST endpoints.

Discovery endpoints:

- `/.well-known/oauth-protected-resource/mcp` (also root `/.well-known/oauth-protected-resource`)
- `/.well-known/oauth-authorization-server`

AS endpoints are `/register`, `/authorize`, `/token`, `/revoke`. Registration accepts HTTPS redirects or explicit loopback HTTP redirects, without fragments/userinfo; authorization requires exact registered URI including port. Native clients must register the actual callback port. The database registry is capped at 1000 clients; SDK rate limits apply to authorization, registration, token and revocation. Registry capacity requires operator review/removal rather than silent client replacement.

Authorization redirects to the independent `/oauth/consent` account page. This page uses existing account login/session, account identity guard and CSRF protection. It shows the client-supplied name, actual callback, resource and requested scopes; no token is issued by merely opening it or logging in. User approval requires POST + CSRF and is single use. Project checkboxes start unchecked. An explicit separate choice grants all the user's current/future projects; otherwise the stored allowlist is restricted to selected owned projects (empty means none). Creating projects requires the create scope and explicit all-project access. Project ownership checks still apply. Delete permission is granted only if explicitly requested and approved; the default scope is read only.

Authorization request lifetime is 10 minutes. Hashed authorization codes expire after 60 seconds and are single use, bound to client/redirect/PKCE/resource/user. Opaque access tokens expire after one hour; only hashes and prefixes are persisted. They share existing `api_tokens` metadata, revocation and transactional business authorization checks, so disabling users or revoking tokens blocks future operations. OAuth access tokens can be revoked with `/revoke` by the issuing client or via existing personal/admin token management.

`tests/service/oauth.test.ts` uses actual SDK client discovery, dynamic registration, PKCE and exchange against a disposable PostgreSQL schema and real loopback HTTP server. It checks explicit CSRF consent, restricted projects, missing delete scope, exact resource binding, wrong verifier, code replay/expiry, unsafe clients/redirects, unsupported scope/plain PKCE, wrong-client revocation, PAT rejection and disabled users. This proves SDK compatibility; hosted ChatGPT, Claude, Cursor and other third-party clients require their own acceptance before compatibility claims.

Protocol sources: [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [RFC 8707 resource indicators](https://www.rfc-editor.org/rfc/rfc8707), [RFC 7636 PKCE](https://www.rfc-editor.org/rfc/rfc7636), [RFC 9728 protected-resource metadata](https://www.rfc-editor.org/rfc/rfc9728).

Migration `007_oauth.sql` adds separate OAuth client/request/code/access-token binding tables. Rollback removes only OAuth-issued API tokens and these tables. This implementation has not been deployed and no production credentials were created.
