# 主题库 v1.2 · 剩余非编辑器验收清单

更新：2026-10-12。依据路线图 §8–9、[本地验收](v12-theme-library-local.md)、[Hakari验收](v12-theme-library-hakari.md) 和 [T001–T032进度表](../architecture/theme-library-v1.2-progress.md)。这是剩余验收与延期记录，不是通过报告。

## 已有证据边界

既有批次记录精确源码 CI 与公网 8 阶段协议/MCP/权限验收。本批 `npm test` 共 290 项（289 通过、1 项既有跳过、0 失败），服务测试 84/84 通过，类型检查和构建通过；真实本地 UI 也验证了主题 `1.0.0`→`1.0.1` 及旧版本固定，以及 4 页文稿上的 9 项样式预览、明确确认、保存和撤销入口。不要把这些证据重复算成下面仍待完成的跨浏览器/PPTX/真实性能验收；生产备份和实际回滚演练按用户决定延期。

## 剩余非编辑器验收与延期

| 缺口 | 路线图 | 验收动作与通过证据 | 当前状态 |
|---|---|---|---|
| 主题导出的 HTML 文件离线可用 | T022、T027、T029 | 后续如重开该项，从正式 UI 下载可编辑 HTML 和观众 HTML，再按路线图覆盖断网打开、主题/图片显示、键盘/片段播放、无外部请求、可编辑文件往返与观众内容隔离；保留原始下载件、浏览器版本、控制台/请求结果与哈希。 | **用户明确延期，不阻塞本 Alpha 批次部署；未验收，不记通过。**受限浏览器拒绝 `file://`，自动审核也拒绝以本机 HTTP 作为替代打开下载产物；没有绕过这些限制。`npm run test:offline` 只测通用 `examples/five-slides.html`，不能证明主题导出离线可用。 |
| Chrome/Firefox 正式入口与窄屏边界 | T009–T014、T029 | 在两个独立浏览器 profile 从主题库正式入口完成浏览/详情/新建/单页应用/撤销/保存重开；再检查桌面与 390×844 窄屏、空库/错误提示。记录无页面错误、无横向溢出、所选页外不变。 | **Firefox 测试由用户明确延期，未验收**。现有 v1.2 真实 UI 记录是 Codex 内置浏览器；旧的 Chrome 记录不能代替 Firefox/v1.2 本轮记录。可复用隔离浏览器资产，勿复用/改动用户 profile。 |
| 三种语言的真实渲染差异与 Motion 降级 | T017、T019、T027 | 同一真实五页文稿分别应用三种设计语言；比较编辑器/放映/HTML 的排版、网格、图像/图形及运动，而非只比较色值。核对进入、退出、转场、减少动态设置；每个不支持项须明确显示支持/降级/拒绝及原因，能选择受控降级或取消。保存同文稿截图、播放步骤、诊断报告。 | **进行中，未验收**。可编辑/观众 HTML 导出已响应 `prefers-reduced-motion`；主题 Skin 不生成新动画，原生 Motion Runtime/完整降级和三语言实播差异仍待验收。 |
| PPTX/兼容诊断报告可信 | T020、T027 | 对主题文稿运行静态诊断，核对字体回退、缺失/损坏资产、固定引用、HTML/PPTX 限制和已知动效差异；PPTX 仍须在实际 PowerPoint 打开并逐页记录支持/差异/不支持。不得把 ZIP/XML 检查或网页截图写成 PowerPoint 视觉通过。 | **CLI 与 API 已实现并有本批测试覆盖；PowerPoint 实测仍未验收。**静态诊断明确不证明 PPTX 视觉保真。 |
| 大目录/多页预览性能 | T007、T029 | 保留 `tests/library-performance.test.js` 的 1,000 条列表请求基线；真实浏览器记录目录首次可交互、预览耗时、请求数和内存，覆盖大目录与较大文稿及受限网络。 | **部分有证据**：24 条分页与 1,000 条元数据单测通过；真实浏览器耗时、内存和慢网测量仍未验收。 |
| 主题资产与版本回读边界 | T008、T021–T024 | 使用隔离账号验证历史固定版本读取、哈希验证资源接口、损坏/缺失资源拒绝、导入/导出往返及版本发布不改写已 pin 文稿。 | **部分有证据**：服务测试覆盖版本和哈希资源路由；本地 UI 查看旧版 `1.0.0` 时保留原强调色。文件往返和损坏恢复 UI 流程仍未验收。 |

### 操作配方

在 `/private/tmp/sp-v11-services`：

```sh
git rev-parse HEAD
git status --short --branch
node --test tests/theme-manifest.test.js tests/theme-library.test.js tests/theme-application.test.js tests/theme-preview.test.js tests/theme-workflow.test.js tests/cloud-theme-store.test.js tests/library-performance.test.js tests/html.test.js tests/audience-export.test.js tests/visibility-export.test.js
node --test tests/theme-diagnostics.test.js
npm run typecheck:service
npm run build
```

这些是聚焦源码/服务与导出契约检查，不能替代真实浏览器。勿因源码有改动而重跑或宣称整套服务验收，除非改动触及服务边界。服务测试需隔离 PostgreSQL 时按 `docs/acceptance/v12-theme-library-local.md` 的本机隔离库配置执行 `npm run test:service`，不可指向生产库。

服务端和源码结果已在本批实际运行中确认：84/84 服务测试通过，`npm test` 290 项（289 通过、1 项既有跳过、0 失败），类型检查与构建通过。`tests/html-offline.py` 仍只覆盖 `examples/five-slides.html` 的通用离线基线；按用户决定，本 Alpha 批次不运行或替代真实主题下载件的离线验收。若以后用户重开该项，先复核浏览器允许的验收路径，不能把离线脚本的通用样例结果当作主题文件通过。

后续跨浏览器 UI 验收可用独立 profile。已知隔离浏览器资产在 `/private/tmp/sp-v11-firefox-browser/Firefox.app/Contents/MacOS/firefox`，Chrome 可执行文件在 `/Users/jxcz/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`。旧 profile 目录仅供识别环境，不要启动或覆盖。

## 不计入本轮必过项

- AI 风格重构、社区分享/审核/评分/推荐：T031–T032 明确是后续 P2。
- 社区市场、付费、主题签名平台/密钥服务：不要为本轮扩大验收范围。导入安全和来源/许可信息仍须满足已有边界。
- 生产备份、离机备份、恢复与部署回滚：用户明确延期；旧发布保留不是演练证据。延期期间不要宣称 Stable 恢复保障。
- 编辑器会话任务/编辑器特定新增功能：本轮不派发。上表的正式 UI 浏览器路径属于独立验收，不要求创建聊天任务。
- 真实触控设备、多设备同步、模板库和完整 Design Systems 自动转换：仍是未交付或依赖项。固定版本资产读取和主题历史/升级 UI 已在本批实现，不应继续列作排除项。
