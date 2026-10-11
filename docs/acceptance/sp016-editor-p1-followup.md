# SP-016 editor P1 follow-up — 2026-10-11

Both P1 findings from `sp016-editor-boundary.md` are now repaired. This follow-up supersedes its open-P1 status, while leaving the complete release gate open.

## Cherry-pick delivery

Checkout: `/Users/jxcz/Documents/Codex/2026-10-11/task-2/Superior-Point`, branch `editor-sp016-export-boundary`. Baseline for this follow-up: `a61281b05799600138d13556afbfd244498b4776`.

1. `1a2f7b8d5775806615abcf9ab7037ca794815426`: canonical hidden state in native previews. Files: `adapters/editor-v038-model.js`, `tests/editor-hidden.test.js`. Requires the preceding `031f180c398296c9f2b4797fe34777f81078f70d` visibility helper. Hidden objects and hidden-group descendants project to native `visible:false`; unedited round trips restore original flags and complete data. Native show updates the object's own hidden flag without defeating ancestor hiding.
2. `c463d91ff51713c5861d9e969f4ae833ca3d4345`: end active editor gestures on writer loss. Files: both `tools/editor*-bridge.inc.js`, both editor builders, generated `vendor/editor-integrated.js` / `vendor/editor-v038-candidate.js` and their manifests, `tests/editor-writer-drag.test.js`, `tests/helpers/editor-candidate.js`. Stage, legacy timing and animation-track drags stop at the current draft without rolling back recovery data; read-only pointer movements cannot mutate it, and reacquiring ownership does not resume the old gesture.

Generated editor modules were rebuilt through their builders, never hand-edited. Original vendor HTML, service/cloud/admin, `web`, and `dist` are unchanged. Service integration still needs to rebuild the standalone distribution through its normal build step.

## Verified commands

All commands ran in the checkout above; successful final full suite ran at `c463d91ff51713c5861d9e969f4ae833ca3d4345`.

| Command | Exit | Evidence |
| --- | --- | --- |
| `node --test tests/editor-hidden.test.js tests/editor-model.test.js tests/editor-adapter.test.js tests/adapter-failures.test.js tests/motion-integration.test.js` | 0 | 17 passed; adapter/data round trips and actual JSDOM editing-stage nodes |
| `node tools/build-editor-candidate.js` and `node tools/build-editor-integration.js` | 0 | Reproducible generated modules; original source hash checks retained |
| `node --test tests/editor-writer-drag.test.js tests/editor-candidate.test.js tests/editor-v039.test.js` | 0 | 28 passed; `work/sp016-writer-drag-tests.log` |
| `node work/sp016-drag-recovery-audit.mjs` | 0 | `moved before loss 109.7`, `readOnly true recoveryX 109.7 currentX 109.7 drift false`, `errors []` |
| `npm test` | 0 | 179 tests: 178 passed, 1 skipped, 0 failed; `work/sp016-p1-full-tests.log` |

Regression tests reproduced the failures before rebuilding: stage-drag tests failed with old generated modules; the clean animation-track gesture / lost ownership / regained ownership test failed in both editor versions. The final tests cover read-only, reject, update, pre-loss recovery retention and clean gestures.

## Actual Edge UI acceptance

Used installed Microsoft Edge through native UI after the browser connector failed. Created the independent project `SP016 Edge 主路径 20261011`; existing projects were not overwritten.

- Inserted text and edited it to `SP016 Edge text acceptance`; inserted a rectangle.
- Actual pointer drag changed rectangle position `(260,185)` → `(390,280)`.
- Actual resize handle changed `380×235` → `476.4×292.8`; actual rotation handle changed `0°` → `52°`.
- Inserted `tests/fixtures/images/tiny.png` through the native file chooser. Returned to home and reopened the saved project: text and image present, three objects.
- Downloaded the actual full HTML backup via the share menu: `/Users/jxcz/Downloads/SP016 Edge 主路径 20261011.html`, 270205 bytes, revision 8. Parsed readback confirmed the text and exact rectangle geometry above. Its inline PNG payload matches all 94 bytes of the original fixture.
- Reimported that downloaded HTML through the workbench file chooser: independent import copy, three objects including image, saved revision 0. Screenshot: `outputs/sp016-edge-reimport.png` in the output directory below.
- Loaded the two-page hidden fixture, then reloaded the test tab to load the changed parent adapter. Both thumbnails excluded hidden text; selecting page 2 displayed only `SECOND PUBLIC PAGE`, with no `PRIVATE_SP016_CORE_SECRET`. Screenshot: `outputs/sp016-edge-hidden-preview.png`.

Output directory: `/Users/jxcz/Documents/Codex/2026-10-11/https-github-com-j-x-c/outputs`. It contains `sp016-edge-backup.html`, `sp016-edge-backup-evidence.json`, `sp016-p1-tests.log` and the screenshots. Closed the test-only Edge tab; test projects remain available for inspection.

## Unverified gates

Chrome and Firefox were not found at their standard `/Applications` locations and are absent from available browser inventory. Their actual mainpaths remain unverified. No browser was installed in this package.

Actual full Edge quit/relaunch was not performed: an existing user tab has `保存失败 · 写入权已失效，改动仍保留` for `图片与拖拽验收 20261011`, with recovery/export actions available. The existing tab was preserved. Navigating home, closing the test tab and reloading are not process-restart evidence.

The writer-loss fix has source/JSDOM regression proof, not a real-browser mid-pointer-gesture ownership-loss reproduction. Service restart, file-offline playback, remaining named-browser paths, clipboard/permissions, timeline visual/export comparison and validated-only PPTX remain outside this completed evidence. SP-016 is not marked release-complete.
