# SP-016 editor export boundary acceptance — 2026-10-11

The editor package fixes hidden objects leaking into generic SVG and audience HTML. Both `visible:false` and `hidden:true`, including descendants of hidden groups, are excluded from audience rendering. Complete backups retain the original data. Hidden resources still undergo the existing safety validation.

## Delivery

- Checkout: `/Users/jxcz/Documents/Codex/2026-10-11/task-2/Superior-Point`
- Branch: `editor-sp016-export-boundary`
- Baseline: `a10a4e3cb54d55023a40f5ea6ecf4d754b14615c`
- Verified source commit: `031f180c398296c9f2b4797fe34777f81078f70d`
- Source files: `io/visibility.js`, `io/html.js`, `io/editor-export.js`, `tests/visibility-export.test.js`.

Service integration can cherry-pick the source commit. The service owner must run `npm run build` to refresh the shared standalone distribution; this package intentionally does not modify `dist`, service code, or shared workbench files. Original vendor files and existing stationary cover whitespace / SVG-only tilt remain unchanged. Unrelated untracked `work/` is preserved.

## Execution evidence

All commands below ran in the checkout above. Logs are local scratch evidence under `work/`.

| Command | Exit | Result | Log |
| --- | --- | --- | --- |
| `node --test tests/visibility-export.test.js tests/audience-export.test.js tests/editor-export.test.js tests/html.test.js` | 0 | 16 passed | `sp016-visibility-review-tests.log` |
| `node --test tests/editor-candidate.test.js tests/editor-model.test.js tests/editor-image.test.js tests/editor-adapter.test.js tests/editor-export.test.js tests/editor-workflow.test.js tests/editor-v039.test.js` | 0 | 49 passed, mainpath source audit | `sp016-editor-audit-tests.log` |
| `npm test` at source commit `031f180c398296c9f2b4797fe34777f81078f70d` | 0 | 163 tests: 162 passed, 1 skipped, 0 failed | `sp016-full-tests.log` |

Real in-app browser acceptance imported a separate two-page fixture into the local workbench, downloaded audience HTML and complete backup through the UI, and opened both generic and native audience HTML over localhost. Both audience pages excluded private text; audience DOM contained two sections and no editable payload. The 211018-byte native audience download also contained no private sentinel. Reimporting the actual backup preserved both hidden strings and flags, two pages and revision 0. Existing user projects were left intact.

Evidence: `work/sp016-browser-exports.json`, `work/sp016-browser-web/native-audience.html`, `work/sp016-browser-web/native-backup.html`. Screenshots: `/Users/jxcz/Documents/Codex/2026-10-11/https-github-com-j-x-c/outputs/sp016-generic-audience.png` and `sp016-native-audience.png` in the same directory.

## Remaining acceptance and findings

This package does not complete roadmap §10.2 or the full SP-016 release gate. Named Chrome/Edge/Firefox browser runs, full browser quit and service restart, offline file playback, actual drag/resize/rotate and clipboard flows, persisted image reopen, timeline/export visual comparisons, validated-only PPTX and iframe permission flows remain separate acceptance work.

Two P1 findings remain outside the evidenced-P0-only repair scope:

1. Writer loss during an active drag preserves the parent recovery snapshot, but subsequent pointer movement can still change the read-only child candidate. Scratch reproduction: x=100 → 109.7, recovery snapshot=109.7, further movement candidate=129. Evidence: `work/sp016-drag-recovery-audit.mjs` and `.log` (exit 0). Recovery integrity remains intact.
2. The native editing preview still displays canonical `hidden:true` objects, whereas `visible:false` is recognized there. Actual imported fixture demonstrated this difference. Generic and audience exports now exclude both flags; native preview normalization remains future compatibility work.

No additional confirmed P0 was found in the editor mainpath audit. Source tests and local in-app-browser export checks are distinct from complete cross-browser release acceptance.
