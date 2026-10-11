# Reliable local editing and delivery

## Problem Statement
The preview supports editing and backups but lacks an audience-only share file, and several everyday editing and persistence behaviours lack real-browser acceptance.

## Solution
Run a loopback-only local workspace for the owner. Keep complete editable HTML/JSON backups. Add a separate offline audience HTML that contains only presentation content and playback data. Demonstrate saving/reopening, recovery, image insertion, drag/resize and offline playback.

## User Stories
1. As the owner, I can open the local workspace without an account.
2. As the owner, I can edit a presentation and reopen saved content.
3. As the owner, I can recover unsaved changes without overwriting another writer.
4. As the owner, I can insert a local raster image and save/reopen it.
5. As the owner, I can drag and resize objects with working undo/redo.
6. As the owner, I can export a full editable backup and reimport it.
7. As the owner, I can export an explicitly labelled audience share file without notes, comments, history or editable document payloads.
8. As the audience, I can play the share file offline with visible slide content and supported animation intact.

## Implementation Decisions
Reuse current local storage, Core, editor adapter and export paths. Introduce audience export beside backup export. Preserve authoritative documents and native editor source. Public export must omit hidden slides and private metadata; keep only supported visible presentation content and fixed runtime dependencies. Do not silently claim unsupported resources are exported.

## Testing Decisions
Confirmed by user: test existing public export interfaces and real-browser user flows. Use red/green tests for new audience export behaviour, existing Node tests for regression, and actual browser interactions for editing/persistence/playback. Report tab reopen separately from full browser process restart. Use disposable acceptance projects; leave user projects untouched.

## Out of Scope
Accounts, cloud sync, live MCP pairing, themes, new PPTX support, recording, cross-browser support guarantees, automatic boot startup.

## Further Notes
Baseline bb5190d8ff220ba0be7e0a6135af001c59d2d980. User approved four local tickets and subagent implementation on 2026-10-11. Application remains a preview; verified acceptance boundaries must be explicit.
