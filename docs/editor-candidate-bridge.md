# v0.39 editor integration candidate

This integration uses the editor formally handed over by the owner; see EDITOR_HANDOFF.md. Its acceptance limits remain explicit. The user-supplied v0.39 editor remains unchanged. `vendor/editor-v039.source.html` is its byte-for-byte copy; `vendor/editor-v039.source.sha256` and the generated manifest record its SHA-256.

## Rebuild

Run `node tools/build-editor-integration.js` before the framework bundle build. The builder refuses an unexpected source hash or a patch anchor that no longer matches exactly. Edit the builder or `tools/editor-bridge.inc.js`, never the source copy or generated candidate module.

Generated outputs:

- `vendor/editor-integrated.js`: complete editor HTML with explicit candidate-only patches
- `vendor/editor-integrated.manifest.json`: source/candidate hashes and patch inventory
- `vendor/editor-integrated-playback.js`: original self-contained playback functions, extracted from the SHA-verified source; not taken from an iframe response

## Authority and transport

`createLegacyEditorAdapter()` returns `{candidate: true, mount(context)}`. The iframe has `sandbox="allow-scripts allow-downloads"`, deliberately without `allow-same-origin`. CSP blocks network access, nested frames and objects. The framework communicates through `postMessage`, validating the exact frame window and a random channel per mount. Wildcard target origins are necessary because the frame has an opaque origin; the random channel is never treated as a substitute for exact source validation.

The original editor's automatic initialization is replaced with explicit parent initialization. The bridge receives already-mapped data through `canonicalToEditor` and never calls the old importer/normalizer, which changes IDs and discards unknown fields. Imported HTML is never executed.

Every editor commit sends one JSON snapshot and the current parent revision. The parent maps it back with `editorToCanonical` and submits one `replaceContent` operation. An acknowledgement advances the child revision; rejection preserves the edited snapshot as read-only recovery data. User input remains enabled while a commit is pending, so normal typing is not swallowed. The child queues snapshots and sends each after acknowledgement. Initialization, loss of write access and failed sessions remain gated. A flush waiting for acknowledgement captures any newer draft before it resolves. Identical parent repaint is a no-op. Conflicting parent updates preserve the in-flight local snapshot for recovery; old-epoch edits receive an explicit rejection rather than being silently dropped. Parent callbacks and synchronous repaint are coordinated so that a commit's own repaint does not replace the document halfway through an original editor event.

Undo/redo are parent-only. The Ribbon reflects `context.getHistoryState()`. The old editor's project database, project recovery, auto-save, file hub and history jump are disabled. UI preferences use a per-frame in-memory shim. File input/drop routes to `context.onImportFile`; the working document is not silently replaced by the old importer. File-hub/new-project controls return to `context.onHome`. Save/export route to the matching parent callbacks.

## Mount API

- `update(document)`: authoritative parent change
- `setReadOnly(boolean)`: gate editing; changes no project identity
- `flush()`: finish active text/notes editing, submit and wait for all acknowledgements
- `getSnapshot()`: flush and return the legacy JSON snapshot
- `renderLegacyHTML()` / `exportHTML()`: flush and return original rendered slide markup with an embedded legacy JSON payload
- `getRecoveryDocument()`: synchronously map a rejected snapshot to canonical JSON, or return null
- `getRejectedSnapshot()`: synchronously return preserved raw legacy JSON if canonical validation fails
- `destroy()`: invalidate callbacks/RPCs and remove the iframe

Rejected snapshots remain visible and read-only. `flush()` continues to reject until the failed session is recovered or explicitly abandoned; parent updates cannot silently overwrite this content. The adapter invokes `context.onCommitRejected(error)` so the workspace can expose recovery/backup controls. Losing write access also captures unblurred contenteditable text and pending notes before locking.

Flush must run before the parent sets `closing` or read-only during a normal navigation. The parent must not render iframe-returned HTML directly in its own origin. Pass it through the separate export sanitizer and inject only fixed trusted runtime code from `editor-integrated-playback.js` and the existing Reveal bundle.

## Validation and limits

Targeted tests: `node --test tests/editor-candidate.test.js tests/editor-adapter.test.js`.

These are jsdom simulations, not browser acceptance. They cover source integrity, explicit boot, zero old persistence access, preserved IDs/unknown fields, original motion markers, parent revision commits, undo delegation, pending notes flush, rejection recovery/old-epoch acknowledgement, preservation of unblurred text and pending notes at lock loss, untrusted file routing, exact source/channel authentication, opaque sandbox configuration, read-only enforcement, and pending RPC cleanup.

Real browser acceptance must still check layout, canvas drag/resize, text editing/selection, media permissions, and presentation playback. Clipboard and recording capabilities may be restricted by the opaque sandbox; no additional permissions are granted automatically. ZIP project-package export is explicitly disabled until parent import/export supports the package. The existing PPTX export path and original embedded dependencies are retained; its entry point warns that this round has not validated PPTX compatibility. Use parent HTML export or JSON backup for the verified candidate workflow. The candidate uses the framework's bundled offline Reveal runtime rather than fetching the source editor's CDN dependency.
