# Superior Point v0.0.1 — Preview

Early public preview, released 2026-10-11.

## Included
- Local IndexedDB project library; create, rename, duplicate, trash and restore.
- v0.39 MiMo editor integration with parent-owned save/undo and conflict recovery.
- Full editable HTML and JSON backups; import/reopen; bundled Reveal.js playback.
- Five-slide example, reproducible build scripts, automated tests and stdio MCP bridge.

## Start
Use Node.js 22 or newer: `npm ci`, then `npm start`. Open http://127.0.0.1:8787/. Keep the same browser and origin for your project library. The standalone `dist/SuperiorPoint_v0.0.1.html` is supplied for experiments; independent file:// persistence is not yet validated.

## Important limits
This is a pre-release, not production-ready. No HTTP backend, cloud database, accounts or cloud synchronization. MCP file storage and browser storage are separate. Browser data deletion can erase local projects; export backups.

Editable HTML exports include notes, comments and retained history. Review them before sharing publicly; no audience-sanitized export is provided. Complex PPTX fidelity, independent file:// behavior, full browser-restart persistence and cross-browser compatibility remain unverified. Local image insertion was blocked by the browser-test tooling and is not recorded as passed or as an application defect.

See docs/VALIDATION.md for the precise verification scope. Project-original code has no declared open-source license; the bundled Reveal.js MIT license is preserved.
