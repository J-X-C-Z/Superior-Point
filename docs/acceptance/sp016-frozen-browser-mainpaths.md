# SP-016 frozen candidate: Chrome / Firefox mainpaths — 2026-10-11

Requested local editing mainpaths and genuine browser quit/relaunch passed in both engines. This document is an independent acceptance handoff; it does not change the frozen service candidate or declare the full SP-016 release gate complete.

## Target identity

- Candidate checkout: `/Users/jxcz/.codex/.chatgpt-projects/g-p-6acaf26c67908191983e413a278752ce/Superior-Point`
- Candidate commit: `4cb41eab9f8cec444527c9957aae92df9c75a705`
- Candidate URL: `http://127.0.0.1:8769/web/`, distinct from the subsequent editor work on port 8787.
- Candidate HEAD and clean Git status were read back before and after acceptance. Source, deployment configs and backend were untouched.
- Parent read-only HTTP check exited 0: served `web/app.js`, `adapters/editor-v038-model.js` and `vendor/editor-integrated.js` exactly match checkout bytes and SHA-256. Evidence: `output/playwright/sp016-frozen/served-identity.json`.

No subsequent common-editing feature commit was included in this candidate. The report was authored in the independent editor checkout `/Users/jxcz/Documents/Codex/2026-10-11/task-2/Superior-Point`.

## Browser / process evidence

| Engine | Actual runtime | Session / independent persistent profile | Actual main browser PID before / after restart |
| --- | --- | --- | --- |
| Chromium | Google Chrome for Testing ARM64 `151.0.7922.34` | `sp016-frozen-chrome`; `/private/tmp/sp016-frozen-chrome-profile-20261011` | `10721` → no matching profile process → `13008` |
| Gecko | Official Playwright Firefox build 1553, `156.0`, headless | `sp016-frozen-firefox`; `/private/tmp/sp016-frozen-firefox-profile-20261011` | `10976` → no matching profile process → `13114` |

Both tests used `isolated:false` and a unique `userDataDir` in copied temporary configs. CLI `close` terminated the browser, an executable/profile process check confirmed absence, and `open` launched a new process with the same persistent profile. No tab reload, tab close or storage-state restore was substituted. CLI daemon PIDs are separately recorded and not counted as browser PIDs. Both test sessions were closed again after acceptance; profiles remain for evidence. No user Edge or pending-recovery tab was closed.

Browser operations used the requested Playwright CLI skill and the already-installed CLI `0.1.22`: `node /Users/jxcz/.npm/_npx/31e32ef8478fbf80/node_modules/@playwright/cli/playwright-cli.js`. Default sandbox daemon/loopback access failed with EPERM; scoped authorized local-browser execution succeeded. Offline wrapper returned ENOTCACHED, so the installed CLI was reused. Successful accepted UI, download, import, close/open and assert commands exited 0. Raw logs retain failed automation attempts rather than disguising them as product regressions.

Browser command working directories and all raw evidence are under:

`/Users/jxcz/Documents/Codex/2026-10-11/task-2/Superior-Point/output/playwright/sp016-frozen/chrome`

`/Users/jxcz/Documents/Codex/2026-10-11/task-2/Superior-Point/output/playwright/sp016-frozen/firefox`

Chrome open: `-s=sp016-frozen-chrome open --config=/private/tmp/sp016-frozen-chrome-config.json http://127.0.0.1:8769/web/`.

Firefox open: `--session sp016-frozen-firefox open http://127.0.0.1:8769/web/ --config /private/tmp/sp016-frozen-firefox.json`.

## Actual UI results

Both engines created a separate empty project through the workbench; entered real text, inserted a shape, performed pointer drag/resize/rotation, opened a real image chooser, saved, returned home and reopened. Both downloaded full editable HTML through the UI and reimported that exact download through the workbench chooser as an independent project, preserving the original. After genuine browser restart, UI reopened the original and compared rendered text, geometry, image data and saved revision.

| Evidence | Chrome | Firefox |
| --- | --- | --- |
| Original project | `SP016 Chrome Frozen 20261011` | `SP016 Frozen Firefox 20261011` |
| Actual edited object | Rectangle | Text box |
| Pointer move | `(260,185)` → `(428.1,280)` | `(160,180)` → `(295,260)` |
| Resize | `380×235` → `464×291` | `610×100` → `715×160` |
| Rotation | `0°` → `53°` | `0°` → `76°` |
| Saved revision / objects | 9 / text, shape, image | 8 / text, shape, two images |
| Image fixture | Original repo PNG, 94 bytes; exported bytes exact | Independently generated 16×16 RGBA PNG, 82 bytes; exported bytes exact |
| Full HTML download | 270442 bytes | 271302 bytes |
| Reimport / process restart | Original content retained | Original/imported/restarted rendered arrays exactly equal |

Download SHA-256:

- Chrome: `7b9392de6da865075820bfb4df44c0e8ecacd13baa12de8cf93f904f929493b4`
- Firefox: `9e390e0d1fcebca319e5b3c6c2446a61c88beee1425d4c971de370c494700057`

Parent independently parsed both actual backups through `importHTML`, verified these hashes, element counts, saved revisions, changed geometry and embedded PNG lengths; exit 0. Evidence: `output/playwright/sp016-frozen/parent-readback.json`.

Image automation caveat: an initial `fileChooser.setFiles` uploaded successfully while CLI modal tracking remained; a subsequent CLI `upload` uploaded again. Chrome removed the duplicate through the visible Delete command; Firefox retained both UI-created images and proved all four objects survive every stage. This is not evidence that a single ordinary chooser upload duplicates images. Test layouts intentionally overlap objects and are not design/readability acceptance.

## Evidence files and remaining gates

Chrome: `raw.md`, `summary.json`, `commands.log`, `backup.html`, `backup-document.json`, `processes-before-close.txt`, empty `processes-after-close.txt`, `processes-after-relaunch.txt`, `processes-final-close.json` and timestamped screenshots in `.playwright-cli/`.

Firefox: `report.md`, `verification.json`, `backup.html`, `pointer-geometry.txt`, `saved-canvas.txt`, `home-reopen-canvas.txt`, `imported-canvas.txt`, `restarted-canvas.txt`, `pid-before.txt`, `pid-after-close-confirmed.txt`, `pid-after-open-confirmed.txt`, `reopen-confirmed.txt`, `final-close-process-check.txt`, `before-home.png`, `imported.png`, `restarted.png` and CLI snapshots. The first broad process filter matched its own inspection shell; only the corrected anchored executable/profile check is accepted.

Observed console limits: Chrome's sole error is favicon.ico 404; Firefox has zero runtime errors and 12 repeated unreachable-code warnings per editor mount. Frozen source was not changed to suppress these.

This verifies local editor mainpaths in actual Chromium and Gecko. Cloud backend/production permissions/database/backup/deployment are owned by the service steward and were not exercised here. Edge prior evidence, hidden-preview cases, broad transition/animation equivalence, region selection, clipboard permissions, offline file playback, recording, actual PNG pixels and PowerPoint client compatibility remain separate evidence layers. No complete SP-016 claim is made.
