# Project history API (SP-073)

These authenticated `/api/v1` routes reuse stored `project_revisions`. All reads require active user/session/token, owner-only access and `projects:read`; MCP project allowlists apply. Administrators have no private-content override. Deleted projects cannot be read or restored through history.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/projects/:id/revisions` | Descending metadata array `{revision,title,source,createdAt,slideCount}`; no document or assets |
| GET | `/projects/:id/revisions/:revision` | Complete immutable `SPDocument` snapshot |
| GET | `/projects/:id/revision-diff?from=N&to=M` | `{projectId,fromRevision,toRevision,titleChanged,slideOrderChanged,slides,assetsChanged,themeChanged}` |
| POST | `/projects/:id/restore-revision` | Restored contents committed as a new current revision |

Diff `slides` contains only added/removed/modified slides. Each entry is `{id,status,elements:[{id,status}]}`; elements also contain only added/removed/modified IDs. This structural report locates changes; clients can inspect authorized snapshots for precise field differences. Order-only changes appear through `slideOrderChanged`, or modified slide contents for element ordering.

Restore body is `{revision,expectedRevision,clientMutationId,leaseToken}`; unknown properties are rejected. Revision values are nonnegative safe integers; URL revisions use decimal digits. The requested history revision must be older than current. `projects:write` and a valid exclusive lease are required, including for MCP. Acquire through the existing project lease endpoint. Missing/expired/wrong lease returns `LOCK_LOST`; current revision mismatch returns `REVISION_CONFLICT`. No snapshot is committed on failure.

Restore retains the project ID, its original creation timestamp and database ownership. Historical title, slides, notes, animations, assets, theme references and unknown safe fields are copied through validated Core replacement. The resulting revision is current+1; its update timestamp is new. It creates a new history row and `project.history_restore` audit entry. Old history and later edits are never rewritten. Existing mutation receipts replay the original restore result for the same payload and mutation ID, even after later edits or lease expiry; differing requests return `MUTATION_ID_REUSED`.

This is document history, not database rollback or automatic reversion. Existing trash restore remains `/projects/:id/restore`. The local MCP Bridge is unchanged; exposing history tools belongs to SP-078.
