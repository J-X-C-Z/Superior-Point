# Single-file HTML and generic preview

This is a framework bridge awaiting the user's authoritative editor. It is **not** the final SP editor, editor renderer, or a v0.28/v0.29 replacement.

## API
- `await exportHTML(document)` returns complete HTML with actual vendored Reveal 5.2.1 JS/CSS, embedded raster images, generated SVG slides, and full inert JSON data.
- `importHTML(html)` extracts only an exact inert SP data envelope, uses JSON.parse and the shared core importer, and never evaluates or inserts imported HTML. Ordinary Reveal/third-party HTML is deliberately rejected. The export format is deliberately narrow; do not edit/reformat its JSON script opening tag externally.
- `renderSlideSVG(document, slideId)` produces an escaped generic SVG preview. See exported `RENDERER_LIMITATIONS` for disclosure in calling UI/MCP tools.

## Supported generic preview
Plain multiline text using Arial/system sans-serif, rectangle/ellipse/line/arrow shapes, simple connectors with coordinates, raster PNG/JPEG/GIF/WebP data URLs, plain table cells, simple nonnegative bar charts. Hidden elements and slides, element rotation, page backgrounds and Reveal transitions are supported. Ordered appear fragments use `element.fragment`/`fragmentIndex` or slide animations with `targetId`, `type: 'appear'`, `order`.

Unknown element properties and extensions survive exact structured round trips. Unknown element types show a labeled placeholder. This is lossless **data preservation**, not visual fidelity for unsupported features. Rich text, custom fonts, crop, arbitrary imported SVG, nested group rendering, chart semantics beyond simple bars, object connection binding, complex animations/timing/triggers, and editor interaction are not implemented. Plain text does not auto-wrap; tables preview at most 100 rows and 30 columns, charts 50 bars.

## Safety and offline policy
- Resources must be embedded supported raster data URLs. Any unsupported or missing image or asset fails export/import/preview rather than silently fetching or losing it.
- Raw HTML/SVG/script/style fields and active element types are refused. SVG supplied by the document is never emitted. User strings are escaped; attribute colors/transitions are allowlisted and numeric geometry is bounded.
- A conservative recursive resource-key policy rejects external `src`, `href`, `url`, `source`, `dataUrl`, and `fontUrl` fields even inside unknown extensions. Other unknown safe JSON properties are preserved. This intentionally may reject editor extension formats until an explicit trusted adapter is added.
- Exported JSON escapes `<`, `>`, `&` and Unicode line separators, preventing script-envelope breakout. CSP blocks network, objects, external scripts and forms. The vendored runtime's own static data-URL icons are included.
- Export contains no CDN script/link tags, module imports, or custom-font dependencies. Reveal's MIT notice is in the embedded dist source; license is also supplied in vendor/.

## Checks
`node --test tests/html.test.js` covers exact repeated roundtrip, extension preservation, escaping, inert import, malformed envelopes, malicious/external assets, and offline structure. `node examples/generate.js` regenerates the five-page example. `python tests/html-offline.py` runs isolated Chromium acceptance; `SP_TEST_BROWSER=firefox python tests/html-offline.py` selects Firefox (override `FIREFOX` path as needed). Browser tests emulate offline network and verify file navigation, keyboard, fragments, zero network requests, runtime errors, and JSON preservation. They require a host permitting the browser's local sockets.

## Image byte validation (reference compatibility preparation)

`image-assets.js` accepts canonical base64 PNG, JPEG (including progressive and the legacy jpg MIME alias), GIF and WebP. It verifies MIME/signature agreement, basic container endings/lengths, readable dimensions, and PNG chunk CRCs. Limits: 16 MiB encoded image bytes, 16,000 pixels per dimension, 40 million pixels. Unsupported or invalid images fail before HTML output. This is bounded container inspection, **not a full image-codec decode or proof that every compressed stream is well formed**; actual image decoding/browser compatibility is still separate acceptance work.

Image crop, fit, filters, flips, radius, alt text, rotation and other JSON properties survive roundtrip. That is data preservation, not a promise that the generic renderer paints all properties. `inspectRenderCompatibility()` returns known visual gaps with slide/element/property IDs; the UI reports gaps on export and MCP `sp_validate` includes the same report. Opacity is emitted as a clamped SVG group attribute.
