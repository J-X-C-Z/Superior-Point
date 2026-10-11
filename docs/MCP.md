# Superior Point MCP: phase-one file mode

## Run

Node.js 22+ is required. From this framework directory:

```sh
npm ci --ignore-scripts
node mcp/server.js --project-root /absolute/path/to/authorized-projects
```

Alternatively set `SP_PROJECT_ROOT`. A project root is mandatory; the server does not listen on a TCP port. Configure a compatible MCP client using its normal stdio `command`/`args` configuration:

```json
{"command":"node","args":["/absolute/path/to/framework/mcp/server.js","--project-root","/absolute/path/to/authorized-projects"]}
```

The directory is the entire granted file-access scope. Use a dedicated directory owned by the current user. Do not let another untrusted process rename/replace its parent directories. Only simple IDs and direct filenames are accepted; traversal, nested paths, symlink input files, and symlink output files are refused. Files larger than 32 MiB are refused on read. This is not an OS sandbox against hostile processes sharing the same user account.

## Eight tools

- `sp_create_project`: `{projectId?, title?, canvas?}` creates and durably stores a canonical document, never overwrites an existing ID.
- `sp_open_project`: `{projectId}` opens a saved document; alternatively `{filename:"deck.html"}` imports an editable HTML from the root and creates its embedded project ID. An ID collision fails, leaving the existing project untouched.
- `sp_get_document`: `{projectId, full?}` reads a summary by default. `full:true` returns a detached canonical document.
- `sp_get_slide`: `{projectId, slideId}` reads one slide and the current revision.
- `sp_edit`: `{projectId, expectedRevision, operations}` validates and commits a batch atomically. Mandatory revision check prevents stale overwrites. Returns the durable new document.
- `sp_render_slide`: `{projectId, slideId}` returns sanitized static SVG text plus renderer limitations. No PNG engine is claimed.
- `sp_validate`: `{projectId}` reports canonical validation, layout warnings and known generic-renderer compatibility gaps.
- `sp_save_export`: `{projectId, expectedRevision, filename:"deck.html"}` exports the exact saved revision to a single editable HTML in the root. A simple existing regular output file is replaced atomically.

Tool failures use `isError:true` and JSON `{error:{code,message,details?}}`. Revision conflicts return `REVISION_CONFLICT`. Another live writer returns `PROJECT_BUSY`; reread the current revision before retrying after a conflict. SDK-level malformed input fails schema validation.

## Example batch

```json
{"projectId":"demo","expectedRevision":0,"operations":[{"type":"createSlide","slide":{"id":"slide-1","elements":[],"animations":[]}},{"type":"createElement","slideId":"slide-1","element":{"id":"title","type":"text","x":80,"y":80,"w":900,"h":120,"text":"Superior Point"}}]}
```

Elements deliberately allow extra safe JSON fields. The authoritative editor's renderer schema is not finalized. Preserve unknown fields and use its future adapter/migration boundary instead of guessing a final editor model.

## Save and recovery behavior

Internal `.json` files are implementation storage, not a new `.sp` user exchange format. An edit obtains an exclusive per-project directory lock, reads and checks the revision, applies a detached core transaction, writes a temporary file, fsyncs it, atomically renames it, then fsyncs the directory. Reads see the old or new complete file. Success means that durability sequence completed. If a filesystem failure happens after rename, the commit outcome may be uncertain; reread the project instead of blindly repeating the batch.

Crash-abandoned `.lock` directories intentionally fail closed; inspect the project and confirm there is no running writer, then remove the matching lock directory manually. The server never steals a lock by guessed age. Temporary `tmp-*` files left after a hard crash can be removed once no writer is active. The root should live on a filesystem supporting atomic rename and directory fsync (the delivered integration tests use Linux). Windows/network-filesystem durability is not yet qualified.

Core undo/redo history belongs to each `DocumentCore` instance and is never embedded in an exported document. MCP phase-one edits are durable batches; MCP does not expose durable cross-process undo/redo. Browser storage and this file root are separate libraries: exchange editable HTML for now. Live editor/MCP synchronization is deferred.

## Core model and operations

The canonical schema and TypeScript declarations are in `core/document-core.d.ts`. `createDocument` produces schema 1. `importDocument` accepts validated schema 1 and an explicit prototype schema 0 migration (adds missing revision/assets/extensions/metadata). Future schemas and arbitrary editor documents are rejected until an explicit adapter/migration exists.

`DocumentCore.edit`, `undo`, and `redo` increment revisions monotonically; undo does not rewind the revision counter. Optional `expectedRevision` applies to each. All operations in one edit commit or none do. All returned data are detached; redo branches are cleared by subsequent edits.

The candidate adapter additionally uses `replaceContent` for one atomic snapshot transaction, preserving project identity and requiring the current revision. It participates in the same undo history.

Operations: create/delete/duplicate/move slide; create/update/delete element; group/ungroup; set/remove animation; updateProject. Group children refer to independent same-slide elements using absolute geometry. Groups cannot own the same child or form cycles. Deleting a group deletes its descendants and related animation entries. Ungrouping preserves children. `duplicateSlide` remaps element IDs, group children, conventional sourceId/targetId connector links, and animation targets. Adapter-specific reference fields need a future adapter-aware duplicator.

Animation fields: `{id,targetId,type,trigger,duration,delay,easing,order}`; duration/delay/order are nonnegative numbers. Remove with `setAnimation` and `{animation:null,animationId}`. Core stores extensible animation intent; the generic renderer supports a limited subset and must not be treated as complete editor behavior.

## General AI skill

Read the document or target slide first. Use stable element IDs and the returned revision for a batch. Preview the affected slide and validate the document. Reconcile a conflict by rereading instead of increasing the revision blindly. Export HTML when the user wants a portable/editable artifact. Avoid external asset URLs in an offline deliverable; embed authorized resources. This is guidance, not a mandatory long process for every small edit.

## Verified here

`node --test tests/core.test.js tests/mcp.test.js` exercises atomic rollback, revisions, detached history, group/animation duplication, migrations, unsafe JSON, multi-instance CAS, traversal/symlink rejection, real SDK stdio initialize/list/call, and persistence across server restart. HTML integration has its own tests; cross-browser file:// checks remain separate acceptance work.
