# Local image and manipulation acceptance — 2026-10-11

Baseline: `bb5190d8ff220ba0be7e0a6135af001c59d2d980`. Local workspace: `http://127.0.0.1:8787/web/`. Browser: macOS Microsoft Edge, operated through CUA native accessibility and pointer input. No browser profile was closed and no user project was edited.

## Actual browser result

A disposable project named `图片与拖拽验收 20261011` was created from the UI. The Insert → Picture action opened the macOS file picker. The picker selected `tests/fixtures/images/tiny.png` (94 bytes, 3 × 2 pixels); the real browser decoded and displayed the image and reported `已插入 1 张图片`. Parent workspace reached revision 1 and `已保存到本地`.

The following values were observed directly in the editor's object inspector. Values are rounded to the one decimal place displayed by the UI.

| Step | Revision | X | Y | Width | Height |
| --- | --- | --- | --- | --- | --- |
| Insert PNG | 1 | 240.4 | 93.6 | 799.2 | 532.8 |
| Real pointer drag | 2 | 355.1 | 187.2 | 799.2 | 532.8 |
| Real northwest handle resize | 3 | 429.7 | 236.9 | 724.6 | 483.1 |
| UI Undo | 4 | 355.1 | 187.2 | 799.2 | 532.8 |
| UI Redo + Save to workspace | 5 | 429.7 | 236.9 | 724.6 | 483.1 |
| Return to workspace → reopen project | 5 | 429.7 | 236.9 | 724.6 | 483.1 |

The drag used the visible image body. The resize used the visible northwest handle with aspect ratio locked; width/height retained approximately 3:2. Undo restored the dragged geometry and Redo restored the resized geometry. Reopening the saved project showed the same image, name, aspect-ratio setting and geometry; revision 5 remained saved. Session history reset on reopen, consistent with the existing UI's “仅当前会话” history description.

## Existing automated checks

Executed from the repository root:

```sh
node --test tests/editor-image.test.js tests/image-assets.test.js
```

Exit 0: 27 tests, 27 passed, 0 failed, 0 skipped. These cover asset validation and simulated asynchronous editor operations; the actual browser observations above are separate evidence.

## Limits

This check validates one PNG, single-object drag, northwest resize, undo/redo in the current session and workspace navigation reopen in Edge. It does not establish cross-browser coverage, operating-system/browser process restart persistence, clipboard insertion, batches, every resize handle, replacement, crop/filter fidelity or offline export. Those should retain their separate acceptance status.

CUA IAB creation with `visible:false` and the Edge extension tab API were unavailable to this agent; native CUA Edge input and the system picker completed the flow. No product defect was established and no source fix was needed.
