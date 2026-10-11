# SP016 冻结候选：放映、权限与 PPTX 剩余验收

2026-10-11：本地编辑与离线呈现的实测子集通过；不能据此宣称全屏、媒体录制、完整动画目录或 PPTX 往返通过。若 Alpha 仅承诺本地编辑、窗口放映、HTML 离线导出及下述 PPTX 导出子集，本轮未发现该范围的新阻断；若承诺媒体录制、集成全屏、PPTX 导入或完整强调/组合动画，这些验收缺口构成相应发布阻断。

## 身份与方法

测试运行代码为冻结 `4cb41eab9f8cec444527c9957aae92df9c75a705`，URL `http://127.0.0.1:8769/web/`。开始 checkout 为 `fa2594a9f88d6577878aae832a97c15147a87c6d`，相对冻结 SHA 仅新增此前浏览器验收文档。放映验收期间并行发布流程把 checkout 推进至 `61c9438d460e57be874180aebedb07da967a6a5a`；本报告不把前述浏览器结果改称新版完整验收。两组服务字节读回与冻结 Git blob/先前冻结哈希一致，具体路径与 SHA256 见各自 identity 文件。

使用真实 Chrome 151 独立会话 `sp016-frozen-presentation`、`sp016-frozen-permissions` 和各自 `/private/tmp/` profile，通过界面、鼠标、键盘及正常文件 chooser 操作。未调用内部应用函数、修改 storage、编辑冻结源码或服务；未触碰用户待恢复标签、Edge 或系统剪贴板。两组会话均单独关闭，原始命令、cwd、exit 和输出保存在证据目录。

## PASS：本次确证范围

- **窗口放映与时间轴基础操作**：五页示例从头放映，方向键推进动画步骤及页面、Escape 退出。通过效果卡片添加淡入、脉冲、淡出，实际调整 `after / with` 触发及 1200ms 时长；备份数据保留这三段设置。编辑器整页预览淡入对象 opacity 从约 0.015 变为 1。脉冲运动不在通过范围内。
- **真正的本地 HTML 呈现**：通过 UI 下载观众 HTML 和完整数据备份 HTML，分别打开独立 `file://` 页面。HTTP 路由阻断后探针返回 `ERR_INTERNET_DISCONNECTED`，文件仍初始化内嵌 Reveal。观众页淡入 opacity 0→1，下一步淡出至 0，再推进至第二页，内嵌 PNG 加载完成、naturalWidth=480。备份页导航至第四页，8 个表格单元格和 1 个 SVG 图表实际呈现，console 无错误；截图已目视核对。观众 HTML 不含 `#sp-document`，备份包含完整 canonical 数据及编辑后的 motionEffects。`navigator.onLine` 在 file 页仍为 true，故离线结论依据阻断探针及实际渲染，而非该字段。
- **内部复制粘贴容错**：独立 context 的 clipboard 权限明确 denied，原生复制→粘贴仍使对象数 22→23。额外字符串粘贴使用显式 ClipboardEvent/DataTransfer，属于事件模拟，不证明 OS 剪贴板权限或互通。
- **PPTX 导出结构子集**：集成编辑器真实下载五页 PPTX。ZIP/XML 检查确认文字、形状、1 张内嵌 PNG、第 4 页原生表格及 `ppt/charts/chart1.xml`。这是导出结构验收，尚未证明 PowerPoint 渲染保真。

## 范围限制

工作台 `/web/` 的“打开”明确只接受 SP canonical JSON 或 SP 导出 HTML；实际上传 PPTX 被正常拒绝且现有文稿未改变。因此 PPTX 导入不属于集成工作台可用范围，更不能承诺往返无损。

冻结源编辑器独立入口可导入上述导出 PPTX 的文字/图片子集，但表格、图表以“首版导入占位”呈现，并报告 2 个未恢复对象。另一份已有 PowerPoint 五页实测样例的 SmartArt、表格、图表亦为占位。此结果不能混同工作台导入通过；复杂布局、动画及母版差异仍属预览限制。

录制工作室 UI 自身声明静态 Canvas 幻灯片、240ms 淡化及可选摄像头画中画，排除原生动画、视频播放和系统桌面；入口可达不等于录制通过。

## 未通过或未取得通过证据

**集成原生全屏未通过**：从头放映触发 `Permissions policy violation: fullscreen is not allowed in this document`（about:srcdoc:6753）。窗口放映仍可用，但不能宣传全屏已验收。

**集成媒体授权/录制未通过**：权限 denied 时“检查设备 / 授权预览”产生 microphone Permissions policy violation；最终却显示“跨来源图片可能污染 Canvas”错误文案，纯文字页重试相同。源码 sandbox/统一 SecurityError 映射与该现象吻合，不能把文案作为存在外链图片的证据。未开启实际麦克风、摄像头或录制，媒体录制成功不成立。

**强调/同对象组合尚未取得通过证据**：同对象淡入 `after` + 脉冲 `with` 的播放及单项脉冲预览，经 80/100ms 间隔采样仍为 identity transform、scale none，无对象动画。设置与导出保留通过，脉冲运动未认证；本轮未诊断为全部脉冲效果普遍失效。

## 未测

未测真实 OS 多格式剪贴板、设备授权成功和实际录制、完整 27/46 效果目录、Firefox 放映及动画、原生 PowerPoint 打开导出物、字体/公式/母版/复杂布局保真、PDF、生产或云端发布。此前 Chrome/Firefox 主流程重启证据独立保留于 `sp016-frozen-browser-mainpaths.md`，不扩展为本轮放映跨引擎验收。

## 原始证据

证据根目录：`/Users/jxcz/Documents/Codex/2026-10-11/task-2/Superior-Point/output/playwright/sp016-frozen/`。原始证据保留在独立编辑工作树，本公开源代码包未复制原始浏览器工作目录。下表列出该工作树内的实际相对路径。

| 证据 | 文件 |
| --- | --- |
| 放映原始记录、命令与读回 | `output/playwright/sp016-frozen/presentation/raw.md`、`output/playwright/sp016-frozen/presentation/commands.log`、`output/playwright/sp016-frozen/presentation/readbacks.json`、`output/playwright/sp016-frozen/presentation/identity.json` |
| 实际离线导出物与数据 | `output/playwright/sp016-frozen/presentation/audience.html`、`output/playwright/sp016-frozen/presentation/backup.html`、`output/playwright/sp016-frozen/presentation/backup-document.json`、`output/playwright/sp016-frozen/presentation/summary.json` |
| 权限/PPTX 原始报告 | `output/playwright/sp016-frozen/permissions-pptx/report.md`、`output/playwright/sp016-frozen/permissions-pptx/commands.log`、`output/playwright/sp016-frozen/permissions-pptx/served-identity.json`、`output/playwright/sp016-frozen/permissions-pptx/pptx-zip-inspection.json` |

截图、console 和 snapshots 保留在各证据目录及 `.playwright-cli/`。观众 HTML SHA256 为 `10375bbf38acd24536c50412abda617890d778b8c8f30d1eaadd24067b59f2eb`；备份为 `a73b1111a18868d519a405691804c6c98a7b51684dd7dfeb53dbf188996a9718`。本文只整合既有证据，没有重跑浏览器或新增实现。
