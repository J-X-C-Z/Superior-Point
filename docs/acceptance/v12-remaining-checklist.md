# 主题库 v1.2 · 剩余非编辑器验收清单

更新：2026-10-12。依据路线图 §8–9、[本地验收](v12-theme-library-local.md)、[Hakari验收](v12-theme-library-hakari.md) 和 [T001–T032进度表](../architecture/theme-library-v1.2-progress.md)。这是剩余验收与延期记录，不是通过报告。

## 已有证据边界

既有批次记录精确源码 CI 与公网 8 阶段协议/MCP/权限验收。最新 `npm test` 共 295 项（294 通过、1 项既有跳过、0 失败；日志 `/private/tmp/sp-v12-remaining-js.log`）。本地 UI 已记录个人主题版本固定和 Skin 确认流程；新增窄屏、个人主题归档/恢复、JSON 往返和损坏图片拒绝见[本地补充报告](v12-remaining-local.md)。本机 PowerPoint 限定样例见[独立报告](v12-powerpoint-local.md)。Firefox、离线文件和真实性能仍是不同验收范围，生产备份和实际回滚演练按用户决定延期。

## 剩余非编辑器验收与延期

| 缺口 | 路线图 | 验收动作与通过证据 | 当前状态 |
|---|---|---|---|
| 主题导出的 HTML 文件离线可用 | T022、T027、T029 | 后续如重开该项，从正式 UI 下载可编辑 HTML 和观众 HTML，再按路线图覆盖断网打开、主题/图片显示、键盘/片段播放、无外部请求、可编辑文件往返与观众内容隔离；保留原始下载件、浏览器版本、控制台/请求结果与哈希。 | **用户明确延期，不阻塞本 Alpha 批次部署；未验收，不记通过。**受限浏览器拒绝 `file://`，自动审核也拒绝以本机 HTTP 作为替代打开下载产物；没有绕过这些限制。`npm run test:offline` 只测通用 `examples/five-slides.html`，不能证明主题导出离线可用。 |
| Chrome 正式入口与窄屏边界；Firefox | T009–T014、T029 | 在独立浏览器 profile 从主题库正式入口完成浏览/详情/新建/单页应用/撤销/保存重开；再检查桌面与 390×844 窄屏、空库/错误提示。记录无页面错误、无横向溢出、所选页外不变。 | **已证明**：Codex 内置 Chromium 的 390×844 主题库视口 `scrollWidth=390`；该内置浏览器也有主题操作记录。**未证明**：独立 Chrome 正式入口全流程。Firefox 测试由用户明确延期，未验收。详见[本地补充报告](v12-remaining-local.md)。 |
| 三种语言的跨渲染器差异与 Motion 降级 | T017、T019、T027 | 在编辑器/网页放映/HTML 中比较排版、网格、图像与运动；逐项检查不支持行为及原因。 | **部分验收**：三种精选主题的原始五页导出和三种保留模式导出均在本机 PowerPoint 中实际打开，30 页全部检查并留图；Warm 放映按 Right 逐页前进，未见动画/转场。编辑器、网页放映和 HTML 的同文稿对照与完整 Motion 降级仍待验收。 |
| PPTX/兼容诊断报告可信 | T020、T027 | 对主题文稿运行静态诊断，核对字体、资源、固定引用、HTML/PPTX 限制和动效差异；真实 PowerPoint 打开及逐页截图单独记录。ZIP/XML 检查不计作视觉证据。 | **已证明的范围**：Technical 静态诊断退出码为 0；PowerPoint 16.113.4 实际打开并逐页检查六份五页文件，共 30 页。图表数据保留但轴/配色有差异；字体不嵌入、组合展平，动画/转场不导出。图片放大可见像素边缘，但源 PNG 为 160×100，本轮未测量或证明导出造成分辨率下降。**未证明**：其他 PowerPoint 版本、主题及复杂对象的通用保真。详见[本机报告](v12-powerpoint-local.md)。 |
| 大目录/多页预览性能 | T007、T029 | 保留 `tests/library-performance.test.js` 的 1,000 条列表请求基线；真实浏览器记录目录首次可交互、预览耗时、请求数和内存，覆盖大目录与较大文稿及受限网络。 | **已证明**：24 条分页与 1,000 条元数据列表单测通过。**未证明**：真实浏览器耗时、内存、较大文稿预览和慢网表现。 |
| 主题资产与版本回读边界 | T008、T021–T024 | 使用隔离账号验证历史固定版本读取、哈希验证资源接口、损坏/缺失资源拒绝、导入/导出往返及版本发布不改写已 pin 文稿。 | **已证明**：服务测试覆盖历史版本和哈希资源路由；本地 UI 查看旧版 `1.0.0` 时保留强调色；缺少可选预设的主题能导入并预览；损坏 PNG 导入被拒绝且原列表计数不变；正式 UI JSON 往返除新 `id` 与 `sourceRef` 外字段一致。**未证明**：隔离账号端到端权限矩阵、所有损坏/缺失资源场景和已 pin 文稿完整升级矩阵。详见[本地补充报告](v12-remaining-local.md)。 |

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

最新常规 JS 测试为 295 项（294 通过、1 项既有跳过、0 失败）。此前服务/类型检查/构建结果仍见各自对应的验收记录；不可把它们误认为本轮最新源码检查。`tests/html-offline.py` 仍只覆盖 `examples/five-slides.html` 的通用离线基线；按用户决定，本 Alpha 批次不运行或替代真实主题下载件的离线验收。若以后用户重开该项，先复核浏览器允许的验收路径，不能把离线脚本的通用样例结果当作主题文件通过。

后续跨浏览器 UI 验收可用独立 profile。已知隔离浏览器资产在 `/private/tmp/sp-v11-firefox-browser/Firefox.app/Contents/MacOS/firefox`，Chrome 可执行文件在 `/Users/jxcz/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`。本轮正式 Chrome 工作台仅作为 PowerPoint 样例导出的来源，不替代 Firefox 验收。旧 profile 目录仅供识别环境，不要启动或覆盖。

## 不计入本轮必过项

- AI 风格重构、社区分享/审核/评分/推荐：T031–T032 明确是后续 P2。
- 社区市场、付费、主题签名平台/密钥服务：不要为本轮扩大验收范围。导入安全和来源/许可信息仍须满足已有边界。
- 生产备份、离机备份、恢复与部署回滚：用户明确延期；旧发布保留不是演练证据。延期期间不要宣称 Stable 恢复保障。
- 编辑器会话任务/编辑器特定新增功能：本轮不派发。上表的正式 UI 浏览器路径属于独立验收，不要求创建聊天任务。
- 真实触控设备、多设备同步、模板库和完整 Design Systems 自动转换：仍是未交付或依赖项。固定版本资产读取和主题历史/升级 UI 已在本批实现，不应继续列作排除项。

## 最新非编辑器补充

本轮补齐可选预设契约、过期预览失效、云端来源字段路由、中文导入失败指引；真实 IAB 窄屏、个人 JSON 往返/坏图拒绝/归档恢复、1,000 云端主题与受限网络、云端编辑发布/历史/应用、第二个 Chrome 客户端回读已留证，详见[补充报告](v12-remaining-local.md)。完整 JS 为 296 项（295 通过、1 既有跳过、0 失败），服务主题/MCP 6/6，类型与构建通过。旧行中“真实性能、往返、云端UI待验收”以该报告已证明的限定场景为准；仍不能据此关闭所有渲染器/Motion或 Beta 验收。
