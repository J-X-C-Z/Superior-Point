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
Independent file:// use, full browser process restart persistence, cross-browser behavior, complex PPTX fidelity, dedicated drag/resize acceptance, and local image insertion. The image chooser was blocked by test tooling; no app defect was established.

Editable HTML contains notes/comments/history. It is a full backup, not an audience-sanitized share artifact.
