# Private theme library API

All routes use `/api/v1`, the existing session/CSRF or bearer authentication, and transactional active-user/session/token checks. Administrators have no override for another user's private packages. Bearer scopes are `themes:read`, `themes:write`, and `themes:publish`; defaults do not acquire these scopes. Project allowlists remain project-only restrictions.

- `GET /themes?archived=false&trash=false`: metadata array, no package or asset bytes.
- `GET /themes/:id`: metadata plus `ref: {id, version, hash, snapshot}`.
- `GET /themes/:id/versions?limit=100&offset=0`: metadata-only index `{version,hash,current,createdAt}`, ordered by version descending (lexical). Limit 1–100, offset 0–10000. Archived packages retain their history; deleted packages remain unreadable.
- `GET /themes/:id/versions/:version`: immutable fixed reference.
- `POST /themes` or `/themes/import`: `{theme, clientMutationId}`. New server UUID, original safe fields retained, original `{id,version,hash}` stored in `source`. The adapted snapshot has a newly calculated hash. Local original is never modified.
- `POST /themes/:id/publish`: `{theme, expectedRevision, clientMutationId}`. Package ID must match; version must be new. Published snapshots are never overwritten.
- `PATCH /themes/:id`: `{name?, archived?, expectedRevision, clientMutationId}`. Name is a library label; historical package names remain fixed. Publishing updates the label to the new package name.
- `POST` / `DELETE /themes/:id/favorite`: idempotent favorite relationship.
- `DELETE /themes/:id`: `{expectedRevision, clientMutationId}`. Soft deletion retains package versions and embedded document snapshots. Deleted items cannot be read or published.

Metadata fields: `id,name,version,hash,revision,favorite,archived,deletedAt,source,updatedAt`. Lists additionally carry `author,tags,supportedRatios,colors` from narrowly selected snapshot fields and omit asset data; detail remains the full fixed reference. Local version entries created before timestamp tracking report `createdAt:null` rather than inventing a publication time. Imports and CAS mutations replay their original result for an identical per-user mutation ID; differing content rejects with `MUTATION_ID_REUSED`. Revisions conflict with `REVISION_CONFLICT`; existing versions reject with `THEME_VERSION_EXISTS`.

Schema and resources use the shared theme contract: bounded JSON, image bytes/signatures/hash and licenses, no executable fields or external resource loaders. `GET /themes/:id/versions/:version/assets/:assetId` and `GET /themes/builtin/:id/versions/:version/assets/:assetId` return licensed PNG/JPEG/WebP bytes after validating the exact snapshot identity and asset hash. All reads require a live authenticated actor and `themes:read`; private assets additionally require ownership, including for administrators. Responses set the raster MIME, `nosniff`, private/no-store caching, `ETag`, `X-Asset-Hash`, and `X-Asset-Integrity` (SRI). Missing assets return `THEME_ASSET_MISSING` with reimport guidance; corrupt resources/snapshot references return `THEME_ASSET_CORRUPT`, never unverified bytes. No SVG, scripts or external loaders are served.

Resources remain inside immutable package snapshots; no duplicate asset table or public community service is introduced.

`GET /themes/builtins` lists safe read-only catalog metadata; `GET /themes/builtin/:id` returns its fixed reference. `POST /themes/preview` takes `{themeId,version,hash,ratio?}` and returns static SVG sample slides, verified identity, render compatibility and explicit generic-renderer/font/chart limits.

`POST /projects/:id/theme` takes `{themeId,version,hash,mode?,slideIds?,expectedRevision,clientMutationId,leaseToken?}` and returns the committed document. It requires project write plus theme read, validates the private package ACL and fixed hash, and commits one Core batch using existing project CAS, lease and receipt checks. Preserve is default; callers confirm reset. The original semantic request is fingerprinted before planning, so identical retries return the original result even after later edits. Browser-session writes require their lease when one is active; same-owner MCP atomic theme batches follow existing atomic edit rules.

`POST /projects/:id/theme/preview` takes `{themeId,version,hash,mode?,slideIds?,expectedRevision?}` and returns `{projectId,revision,operations,changes,ref,limitations,scope,manualOverrides,summary,motionDiagnostics}`. It requires project read and theme read, checks an optional expected revision, and creates no document revision, receipt, lease or audit mutation. `slideIds` is a nonempty unique list of existing slides; omit it for the whole document. The same scope is accepted by theme apply and is included in the mutation fingerprint. Unselected slides remain unchanged.

`GET /projects/:id/theme/compatibility` requires project read and theme read and reports the saved revision, `kind,valid,themeReferences,diagnostics` from metadata-only Core diagnostics (including missing/corrupt resources and fallback fonts), motion diagnostics for its bound snapshots, and generic render compatibility. It does not fetch a newer theme version or change the document. PPTX diagnostics are capability limits, not PowerPoint visual acceptance.

MCP `sp_preview_theme_application` uses the project preview route; `sp_validate_theme_compatibility` uses the saved compatibility route. `sp_apply_theme` accepts `slideIds`. `sp_list_themes` accepts optional `query` to search authorized names, IDs and tags; search uses the existing list capability rather than adding a second discovery tool. Old PATs do not gain either theme scope.
