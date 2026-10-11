# Local save and recovery acceptance — 2026-10-11

Repository: Superior-Point. Baseline HEAD: `bb5190d8ff220ba0be7e0a6135af001c59d2d980`.
Local workspace: `http://127.0.0.1:8787/web/`.

## Real browser observations

Used two agent-created Codex in-app browser tabs through CUA. User browser profiles and projects were not modified. Acceptance projects remain available as test data.

1. Created `保存恢复验收 20261011` with the UI. Changed the workspace title to `保存重开已修改 20261011` and the editor's speaker notes to `验收备注：保存重开后保留`. Clicked **保存到工作台**; the visible workspace reported **已保存到本地 · 修订 2**.
2. Returned to the workspace and reopened the project. Both title and speaker notes retained their edited values; revision remained 2.
3. Opened the same project in the second browser tab. The workspace title was disabled and the status reported **只读 · 写入权暂被占用，等待释放；可主动接管。**
4. In the original writable tab, changed the title to `原项目权威更新 20261011` and saved revision 3. In the still-read-only second tab, clicked **恢复为独立项目**. It opened `保存重开已修改 20261011 · 恢复副本`, revision 0, retaining the notes and explicitly identifying source revision 2.
5. Renamed the recovered project to `恢复副本继续编辑 20261011`, saved revision 1, returned home and reopened it. Its title, notes, revision 1 and recovery-source notice survived.
6. Returned home and reopened the original project. It retained `原项目权威更新 20261011`, revision 3 and its notes. The recovery did not overwrite the original writer's newer document.

Screenshot: `../work/save-recovery-projects.png` shows the original and recovered project side by side on the workspace.

This run proves project close/reopen and a read-only stale snapshot recovery. It does **not** prove full browser process restart persistence or an unsaved in-flight writer takeover through the real browser. The latter has automated simulation coverage below. No storage defect was reproduced; no storage or application source change was warranted.

## Automated coverage

Command: `node --test tests/storage.test.js tests/save-recovery.test.js tests/lease-reopen.test.js`

CWD: `/Users/jxcz/Documents/Codex/2026-10-11/task-2/Superior-Point`

Node: v26.8.1. The first baseline invocation passed all 22 checks. Original summary:

```text
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8097.209042
```

That invocation was followed in the same shell by environment probes which exited 1 because system Python lacks Playwright and Google Chrome is not installed. The Node test summary itself reported zero failures. A later independent invocation during concurrent export development exited 1 (7 passed, 15 failed), because `io/editor-export.js` temporarily imported `legacyPresentationCSS` before the vendor module provided it. This is an integration-time missing export, not a saving failure. After the vendor playback rebuild, the final focused rerun exited 0 with all 22 tests passing (duration 7514.999958 ms). The temporary missing export was resolved and is not a final defect.

These tests use JSDOM/fake-indexeddb. They cover durable connection close/reopen, CAS revision fencing, lease ownership, pending autosave retention, quota failures and retries, stale adapter callbacks, fresh recovery identity, preservation of original content and latest local content, and in-flight failures.

## Existing browser harness limitation

`tests/browser-framework.py` hardcodes `/usr/bin/chromium` and port 8768. This Mac has Edge and uses port 8787; Python Playwright is absent. Its restart check asserts one text element, not entire document equality, and it exercises retry-save but not **恢复为独立项目**. It was not used as current acceptance evidence. A temporary independent Edge probe did not complete, and is likewise not counted as restart evidence.
