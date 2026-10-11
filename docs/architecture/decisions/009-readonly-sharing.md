# SP-084 assessment / SP-085 fixed-revision readonly sharing

Status: implemented on the development branch; public deployment and browser playback acceptance remain separate.

## Decision

Keep project mutation authority with its current owner and the existing verified web-session/PAT business checks. A platform administrator does not become a project owner merely by being an administrator. Full account-based Owner/Editor/Viewer ACL is not implemented by this change: Editor concurrency, permission changes and user-bound Viewer access require a separate project ACL design. SP-084 is an assessment, not a claim of complete collaborative editing.

For SP-085, the owner creates an expiring readonly capability for the **exact current revision**. The service precomputes and stores the existing safe `audience:true` HTML export. Later document edits never become public through an existing link. Creation rejects a stale expected revision, known renderer gaps and unsafe export resources. It does not publish an editable HTML document, canonical JSON, revision history, comments, notes, hidden slides or private extension content. This preserves the existing exporter and its known playback limits rather than adding another renderer.

Share creation, listing and revocation require the current project owner with an active verified web session; creation/revocation also pass the normal CSRF/Origin checks at the route boundary. MCP/PAT/OAuth actors cannot manage shares. Owner role may be `user` or `admin`; the access decision is ownership, not platform administration.

## Capability and lifecycle

A share token has a `sp_share_` prefix and 32 cryptographically random bytes encoded as base64url. Only its SHA-256 hash is stored. The raw token and share URL are returned once at creation; listing cannot recover them. Default expiration is seven days; the maximum is 30 days. The audience GET rechecks unrevoked/unexpired share, active owner, current project ownership and non-trash project. Changing owner invalidates the old owner's links. Disabled/trash state blocks access while that state remains in effect; restoring an active owner/project may make an unrevoked, unexpired fixed-revision link usable again. To permanently disable a link, revoke it.

Links use `/share#<token>` so the token is not sent in the page URL to the server. The viewer immediately removes the fragment from browser history and keeps the token only in memory. It then makes a readonly GET to `/api/v1/public/shares/view` with a Bearer header, `credentials:omit`, no cache and no redirect. Token query parameters and cookies are rejected by this endpoint. Refreshing loses the in-memory token; reopen the original complete link to view again. No local/session storage, URL query or server-side raw-token recovery is provided.

The returned HTML plays in a sandboxed iframe with `allow-scripts` but without `allow-same-origin`, forms, popups, downloads or top navigation. The generated audience document keeps the exporter's restrictive CSP and contains only the trusted bundled playback runtime. The containing page has no editing controls or authenticated cookie access. Sandbox behavior follows [MDN's iframe documentation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox). Pixel fidelity and real browser playback remain bounded by the existing audience renderer acceptance.

Migration 009 adds `project_shares` (fixed safe HTML, hashed capability, owner/revision/expiry metadata) and `project_share_access` (share ID and timestamp only). Share creation/revocation create audit events keyed by share ID. Audience views record neither raw token, IP address, user agent, document body nor account identity; counts describe successful requests, not unique people. Invalid-link responses use one generic unavailable error. Response caching and referrers are disabled. Operator logs must continue to omit Authorization headers and response bodies.

Share HTML is included in owner storage usage via `octet_length(html)`, including expired/revoked snapshots which still consume storage. Creation takes the same owner quota lock before project locks and enforces the existing quota after insertion, so exceeded quotas roll back the share and audit transaction. Existing content and revoked snapshots are not deleted to make space. Read and revoke remain available when the owner is over quota.

## API

- `POST /api/v1/projects/:id/shares`: `{expectedRevision,expiresAt?}`; returns metadata and one-time `{token,url}`.
- `GET /api/v1/projects/:id/shares`: owner-only metadata, active state and view count; no token/hash/HTML.
- `DELETE /api/v1/projects/:id/shares/:shareId`: owner plus CSRF; revoke access.
- `GET /api/v1/public/shares/view`: header-only share capability; returns `{title,revision,html}` for sandboxed audience playback.

A capability can be forwarded to anyone, and a viewer can retain received HTML/screenshots. Revocation prevents future service requests; it cannot remove already downloaded content. Account-bound sharing, domain restrictions, asset read/write, editable invitations and live revision sharing remain outside this implementation.

## Verification

`tests/service/share-service.test.ts` uses only synthetic projects and disposable PostgreSQL schemas. It covers a non-admin owner, platform-admin isolation, MCP denial, fixed revision/readback, private-field removal, hash-only storage, access metadata, expiry/revoke, owner disable, trash, ownership transfer, session revocation, CSRF, query/cookie rejection, unsupported content, storage quota and audit rollback. `tests/share-page.test.js` checks fragment removal before fetch, cookie omission, title text safety, iframe restrictions and the expired-link/refresh flow; it is DOM evidence, not browser playback acceptance.
