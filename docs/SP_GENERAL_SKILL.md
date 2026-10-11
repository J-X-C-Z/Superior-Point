---
name: superior-point
description: Create, inspect, edit, validate and export Superior Point documents through its eight stdio MCP tools.
---

# Superior Point file-mode MCP

Use the current revision and stable IDs. The shared JSON document is authoritative; the generic preview is deliberately limited until the user's editor is integrated.

- Create with `sp_create_project` or open a project ID / an exported HTML filename with `sp_open_project`.
- Inspect `sp_get_document` and `sp_get_slide` to locate pages/elements and get the revision.
- Send one `sp_edit` call with `expectedRevision` and a batch of operations. Every operation commits together or none does.
- On `REVISION_CONFLICT`, reread and reconcile with the latest content; never blindly increase the revision and repeat stale intent.
- For a small edit, inspect the affected slide and validate if helpful. For a new deck or layout change, call `sp_render_slide` plus `sp_validate` before exporting.
- Use `sp_save_export` for a portable, editable single HTML. Include the latest saved revision. Assets must be embedded supported raster data URLs; no CDN or remote fonts.

Core operations: create/delete/duplicate/move slide, create/update/delete element, group/ungroup, setAnimation, updateProject. Element properties remain extensible. Geometry uses absolute canvas coordinates. Preserve unknown properties, IDs, and unrelated slides.

Current preview supports plain text, basic shapes/connectors, embedded raster pictures, simple tables and bars, basic page transitions and ordered appear fragments. It does not prove final editor fidelity, full typography or complex timelines. A successful SVG response is a static preview, not a browser screenshot.

The server accesses only its configured project root. Browser IndexedDB is separate; import/export HTML is the phase-one handoff. Do not claim a live browser connection, an authenticated AI client, or an end-user account connection from SDK protocol tests alone. Theme systems, cloud accounts/sync, and PPTX expansion are outside this framework phase.
