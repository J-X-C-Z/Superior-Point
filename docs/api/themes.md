# Private theme library API

All routes use `/api/v1`, the existing session/CSRF or bearer authentication, and transactional active-user/session/token checks. Administrators have no override for another user's private packages. Bearer scopes are `themes:read`, `themes:write`, and `themes:publish`; defaults do not acquire these scopes. Project allowlists remain project-only restrictions.

- `GET /themes?archived=false&trash=false`: metadata array, no package or asset bytes.
- `GET /themes/:id`: metadata plus `ref: {id, version, hash, snapshot}`.
- `GET /themes/:id/versions/:version`: immutable fixed reference.
- `POST /themes` or `/themes/import`: `{theme, clientMutationId}`. New server UUID, original safe fields retained, original `{id,version,hash}` stored in `source`. The adapted snapshot has a newly calculated hash. Local original is never modified.
- `POST /themes/:id/publish`: `{theme, expectedRevision, clientMutationId}`. Package ID must match; version must be new. Published snapshots are never overwritten.
- `PATCH /themes/:id`: `{name?, archived?, expectedRevision, clientMutationId}`. Name is a library label; historical package names remain fixed. Publishing updates the label to the new package name.
- `POST` / `DELETE /themes/:id/favorite`: idempotent favorite relationship.
- `DELETE /themes/:id`: `{expectedRevision, clientMutationId}`. Soft deletion retains package versions and embedded document snapshots. Deleted items cannot be read or published.

Metadata fields: `id,name,version,hash,revision,favorite,archived,deletedAt,source,updatedAt`. Imports and CAS mutations replay their original result for an identical per-user mutation ID; differing content rejects with `MUTATION_ID_REUSED`. Revisions conflict with `REVISION_CONFLICT`; existing versions reject with `THEME_VERSION_EXISTS`.

Schema and resources use the shared theme contract: bounded JSON, image bytes/signatures/hash and licenses, no executable fields or external resource loaders. Resources remain inside immutable package snapshots; no duplicate asset table or public community service is introduced.

`GET /themes/builtins` lists safe read-only catalog metadata; `GET /themes/builtin/:id` returns its fixed reference. `POST /themes/preview` takes `{themeId,version,hash,ratio?}` and returns four static SVG sample slides, verified identity, render compatibility and explicit generic-renderer/font/chart limits.

`POST /projects/:id/theme` takes `{themeId,version,hash,mode?,expectedRevision,clientMutationId,leaseToken?}` and returns the committed document. It requires project write plus theme read, validates the private package ACL and fixed hash, and commits one Core batch using existing project CAS, lease and receipt checks. Preserve is default; callers confirm reset. The original semantic request is fingerprinted before planning, so identical retries return the original result even after later edits. Browser-session writes require their lease when one is active; same-owner MCP atomic theme batches follow existing atomic edit rules.
