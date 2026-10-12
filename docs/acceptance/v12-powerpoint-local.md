# 主题库 v1.2 · 本机 PowerPoint 导出验收

日期：2026-10-12。此记录覆盖三种精选主题样例及同一份文稿的保留模式导出在本机 PowerPoint 中的实际打开和逐页检查。结论限于所测文件与环境，不代表全部 PPTX 功能保真，也不代表本轮代码已部署。

## 环境与步骤

- 工作台：本机正式 Chrome 会话，主题库通过本地服务 `18872` 访问。
- PowerPoint：版本 `16.113.4`，build `16.113.26100421`。
- 从主题库分别以 **Editorial（书页叙事）**、**Technical（标尺精度）**、**Warm（暖光故事）**创建五页样例，使用正式 UI 下载 PPTX 与 canonical JSON。三个文件各含五页。
- 以正式下载的 Editorial JSON 为同一份基线，分别用 Core Skin 的 `preserve` 模式应用三种主题，保留三份 canonical 导入件，再经正式 UI 导入为独立项目并下载 PPTX。严格内容清单断言 notes、assets、animations、对象 ID、坐标等非样式数据保持不变，只改 styles。
- 六份 PPTX（原主题三份、保留模式三份）均在 PowerPoint 中打开并逐页查看，共 30 页；无修复错误。截图均来自实际 PowerPoint 窗口。
- 另外检查 Warm 第 5 页的对象选择和放映：`Cmd+A` 可选择三个独立对象；文本对象的 Verdana 字体控件可用。打开幻灯片放映后连续按 Right 逐页前进。

## 结果与限制

| 类别 | 观察结果 |
|---|---|
| PowerPoint 打开 | 六份五页文件均打开并逐页查看，无修复错误。 |
| 保留模式 | 三个输出均以同一份 Editorial 文稿为基线；严格清单确认 notes、assets、animations、对象 ID、坐标等非样式数据不变。Technical 与 Warm 各有 20 项 `fontFamily` 变化、81 项样式变化。页面布局与圆形对象位置保留，没有自动重排。 |
| 原生图表 | 每份样例有一个仍可编辑的原生图表，数据未改变；坐标轴和配色与编辑器有差异。 |
| 图片 | 图片可见，放大有像素边缘；源样例本身是小尺寸栅格图，本轮未测量或认定导出造成分辨率下降。 |
| 对象选择 | Warm 第 5 页的三个对象可以分别选择；这不代表所有对象类型都保持完整编辑能力。 |
| 动画与转场 | 该样例的 PowerPoint 放映按 Right 逐页前进；进入动画和转场没有导出。 |
| 字体、裁切与组合 | 字体只引用、不嵌入。图片裁切、滤镜和适配烘焙为位图，不能在 PowerPoint 中继续独立裁切；组合会展平。 |
| 图表和表格 | 图表/表格可编辑性及原生表现可能不同；本轮的图表数据未改变，但坐标轴与配色有差异。 |
| 分享边界 | PPTX 保留演讲备注和隐藏幻灯片，不应作为观众脱敏版本；公开演示请使用观众 HTML 导出。 |

因此，本机 PowerPoint 的限定样例打开验收通过；完整 PPTX 保真、所有主题和对象类型的兼容性仍未证明。

## 证据文件

原始下载件、原始 canonical JSON、同稿 canonical 导入件、截图及机器可读诊断保存在 [`docs/verification/v12-powerpoint/`](../verification/v12-powerpoint/)：

| 样例 | PPTX 下载件 | canonical JSON / 同稿导入件 | PowerPoint 实际打开截图 |
|---|---|---|---|
| Editorial | [editorial.pptx](../verification/v12-powerpoint/editorial.pptx) | [editorial.json](../verification/v12-powerpoint/editorial.json) | [第 1 页](../verification/v12-powerpoint/powerpoint-editorial-slide1.png) |
| Technical | [technical.pptx](../verification/v12-powerpoint/technical.pptx) | [technical.json](../verification/v12-powerpoint/technical.json) | [第 1 页](../verification/v12-powerpoint/powerpoint-technical-slide1.png) |
| Warm | [warm.pptx](../verification/v12-powerpoint/warm.pptx) | [warm.json](../verification/v12-powerpoint/warm.json) | [第 1 页](../verification/v12-powerpoint/powerpoint-warm-slide1.png) |
| 保留模式 Editorial | [same-editorial.pptx](../verification/v12-powerpoint/same-editorial.pptx) | [same-editorial.json](../verification/v12-powerpoint/same-editorial.json) | [第 1 页](../verification/v12-powerpoint/powerpoint-same-editorial-slide1.png) |
| 保留模式 Technical | [same-technical.pptx](../verification/v12-powerpoint/same-technical.pptx) | [same-technical.json](../verification/v12-powerpoint/same-technical.json) | [第 1 页](../verification/v12-powerpoint/powerpoint-same-technical-slide1.png) |
| 保留模式 Warm | [same-warm.pptx](../verification/v12-powerpoint/same-warm.pptx) | [same-warm.json](../verification/v12-powerpoint/same-warm.json) | [第 1 页](../verification/v12-powerpoint/powerpoint-same-warm-slide1.png) |

完整五页截图按上述 `powerpoint-{theme}-slide1.png` 与 `powerpoint-same-{theme}-slide1.png` 命名，页码为 1–5。严格比较依据为 [same-content-manifest.json](../verification/v12-powerpoint/same-content-manifest.json)；对象可编辑性截图为 [powerpoint-editable-selection.png](../verification/v12-powerpoint/powerpoint-editable-selection.png)。Warm 放映截图为 `powerpoint-warm-show1.png` 至 `powerpoint-warm-show5.png`。 [artifact-hashes.json](../verification/v12-powerpoint/artifact-hashes.json) 记录下载文件哈希和 PowerPoint 版本。`structure.json` 仅为 ZIP/XML 结构检查，不作为视觉验收证据。

兼容诊断另以 Technical 样例运行 CLI，退出码为 0，结果见 [diagnostics-technical.json](../verification/v12-powerpoint/diagnostics-technical.json)；报告会明确列出字体、图像、表格/图表和 Motion 的 renderer 限制。它是静态诊断，不代替以上 PowerPoint 实际打开记录。

同一验证时段内，`npm test` 291 项（290 通过、1 项既有跳过、0 失败；日志 `/private/tmp/sp-v12-pp-js.log`），类型检查与构建退出码均为 0；聚焦 theme/MCP 与 theme-service 测试为 6/6（日志 `/private/tmp/sp-v12-pp-service-focused.log`）。这些自动化结果与 PPTX 视觉记录分别成立，均不代表生产部署完成。
