# v0.0.1 validation

## Release-candidate automated checks (2026-10-11)
- Node.js v24.19.0; clean lockfile installation with npm ci.
- Rebuilt the editor adapter from the unchanged v0.39 source, rebuilt standalone HTML, regenerated demo.
- npm test: 127 tests discovered, 126 passed, 0 failed, 1 intentionally skipped. The skipped v0.32 reference-file byte check needs historical external input not distributed here.
- JSDOM/fake-indexeddb checks are simulations, not proof of real-browser compatibility.

## Mac upload regression (2026-10-11)
- Node.js v26.8.1 / npm 11.19.0; clean lockfile installation with npm ci.
- Rebuilt the v0.39 editor adapter, v0.0.1 standalone HTML and five-slide example.
- npm test: 127 tests discovered, 126 passed, 0 failed, 1 historical-input check skipped.
- The first sandboxed run could not start the loopback test server; the complete suite passed when rerun in the normal local environment.
- No new real-browser or file:// acceptance was performed on this Mac.

## Earlier real Chrome coverage (same usable core, before release metadata changes)
Create/edit/save/reopen, HTML download/reimport, slideshow, multi-tab writer handling and the five-slide example with embedded PNG were exercised. These earlier observations are retained as coverage history, not a claim that every UI feature was retested for this release.

## Not verified
Independent file:// use, full browser process restart persistence, cross-browser behavior and complex PPTX fidelity remain unverified. Earlier image/drag gaps are narrowed by the local development acceptance below.

Editable backup HTML contains notes/comments/history. A separate audience share export is now available; it carries no editable document JSON.


## Local delivery development acceptance (2026-10-11)

- Baseline bb5190d8ff220ba0be7e0a6135af001c59d2d980; implementation branch next-local-delivery.
- Rebuilt editor integration, standalone HTML and example using Node v26.8.1.
- Full npm test: exit 0; 128 discovered, 127 passed, 0 failed, 1 historical-input check skipped.
- Real Codex in-app browser: actual share download, five sections, ready playback, embedded PNG decoded at 480 pixels, slide navigation and third-page fragment progression from 0 to 1. No application/json payload in viewer DOM. This was HTTP playback of the downloaded file, not file:// acceptance.
- Real backup download and UI reimport created an independent five-page project at source revision 0, leaving the original intact.
- Two-tab save/reopen and stale read-only recovery passed; see acceptance-save.md.
- Edge local PNG insertion, real pointer drag, northwest resize, session undo/redo and saved project reopen passed; see acceptance-image.md.
- Both renderer export tests cover private sentinels, hidden slides, payload removal, animation markers, no mutation and unchanged backup roundtrip.
- Browser URL policy rejected file:// navigation. No alternate route was used for file:// acceptance. Offline double-click and full browser process restart still require separate acceptance.
