# v1.1 SP-058 / SP-065 编辑器权限与剪贴板

2026-10-11：实现及定向检查通过。Chrome for Testing 151.0.7922.34 已实测真正全屏/Escape、系统对象复制、跨文稿对象粘贴、普通系统文字手动粘贴与确认插入。Firefox 尚未获计算机使用工具控制批准，不列为通过。DOM 模拟不代表浏览器权限验收。

## 改动及构建契约

- `web/legacy-editor-adapter.js` 仅增加 `allow="fullscreen *"` 和 `allowfullscreen`。`sandbox="allow-scripts allow-downloads"` 不变。
- `tools/editor-permissions.js` 导出 `patchEditorPermissions(source)`。构建器在提取可信播放/导出源码后、注入 editor bridge 前调用；该补丁只作用于集成候选。原始 vendor 文档不可直接改动。
- 全屏请求在 `reveal.initialize()` 的异步等待之前发起，避免初始化消耗点击的用户激活。无 API 或权限拒绝显示窗口放映降级说明；放映工具栏“全屏”可再次尝试。原有 `fullscreenchange` / Escape 退出和窗口模式保持。
- 对象和幻灯片复制先保存内部剪贴板。系统复制只在 `navigator.userActivation.isActive` 下通过浏览器原生 copy 事件写入文本，使用一次性的 textarea 并恢复焦点/选区。仅命令返回成功且事件实际写入才宣称系统复制成功。API 不可用、拒绝、无激活和 1,200,000 字符上限均明确提示内部复制仍可用。
- 非文字编辑状态下的 Ctrl / ⌘ + V 在浏览器默认粘贴动作前聚焦短命 textarea，让真实 paste 事件到达既有 document handler。接收目标不视为文字编辑；收到事件后清理，未收到时 350ms 后清理并使用内部副本或明确提示手动粘贴。只读、会话 epoch / 幻灯片变化、放映、原生对话框及文件中心阻止接收或提交。
- “粘贴纯文本”使用可聚焦、有标签的原生 dialog 和 textarea；用户通过 Ctrl / ⌘ + V 主动粘贴，再确认插入。取消/Escape 不改文稿；空值、原生对象/页面负载和超过 10,000 字符不插入；确认前检查写入会话。避免使用当前 sandbox 禁止的 `window.prompt`。插入/取消均用 `type="button"` 的 click 事件，界面不含 form；不需要被 sandbox / CSP 禁止的表单提交。

## iframe 威胁模型

| 边界 / 威胁 | 最小权限与验证 |
| --- | --- |
| 编辑器脚本接触主站 cookie、storage、DOM 或云端会话 | `srcdoc` 保持 opaque origin，不增加 `allow-same-origin`；文稿仍由 parent Core 管理。 |
| 沙箱来源为 `null`，攻击者伪造消息 | parent 现有 bridge 同时验证 `event.source === iframe.contentWindow`、`spCandidate` 和每次挂载生成的 channel；此次没有新增特权 RPC。 |
| 全屏权限扩大到媒体或系统剪贴板 | `allow` 仅含 fullscreen；opaque origin 必须显式 `*` 匹配，范围限于该 iframe。无 camera、microphone、clipboard-read/write、弹窗、导航或 same-origin 委派。 |
| 编辑器未经用户动作读取系统剪贴板 | 不调用 Async Clipboard readText，不向 parent 请求读取；只处理浏览器主动 paste 事件或用户手动粘贴输入。 |
| 编辑器默默覆盖系统剪贴板 | 写入必须有当前用户激活且符合长度上限；没有背景定时写入。内部对象/页面本身保留，不因系统失败丢失。 |
| 全屏诱导 / 伪装界面 | 保留浏览器自身用户激活要求和 Escape 退出机制。全屏只用于放映；拒绝不阻止窗口放映。 |
| 候选 HTML 运行任意网络 / 外部 iframe | 既有嵌入 CSP 不变：connect/frame/object 禁止，脚本只由可信构建器生成，外部活动 HTML 不执行。 |

没有新增对外通信或 parent 剪贴板代理。copy 命令的兼容性由浏览器决定；失败按内部剪贴板处理。浏览器若不提供 userActivation，保守地只保留内部复制。

## 自动化证据

cwd：当前 Superior-Point checkout。命令：`node --test tests/editor-permissions.test.js tests/editor-adapter.test.js`。退出码 0，8 个测试通过：

- 候选脚本编译、补丁重复/源码漂移拒绝、fullscreen 请求先于 Reveal 异步初始化。
- 系统复制成功、无用户激活、过大、命令拒绝/无事件、焦点和临时 DOM 清理。
- 从候选源码提取实际 document paste handler：临时接收目标上的对象、普通文字、页面负载可到达现有处理；只读/换页禁止提交，无事件超时明确提示。
- 手动粘贴输入校验、重复对话框避免、只读会话保护、成功插入和焦点恢复。
- fullscreen 缺失/拒绝/成功状态，以及 sandbox / 单项权限 / 消息来源和 channel 边界。
- 既有 adapter 原子提交、修订、恢复和 teardown 回归。

## 真实浏览器验收清单与限制

Chrome / Firefox 分别记录版本、构建 SHA、URL、实际系统权限和原始结果：从真实点击进入 audience 全屏，检查浏览器 `fullscreenElement`，Escape 返回编辑；窗口放映和拒绝提示；对象/页面复制后在另一个文稿粘贴；系统普通文字粘贴；拒绝权限/不支持环境的明确内部复制提示；手动纯文本取消不修改、确认可保存/撤销。系统剪贴板属于真实用户数据，浏览器验收必须使用专用测试内容。

本补丁没有授予录制权限。Chrome 通过项和 Firefox 未验收项详见 v11-editor-m1.md；系统拒绝/不支持降级目前是单元模拟证据。只读状态会保留现有交互 gate；若手动粘贴时会话被锁定，输入不提交，但整个编辑器可能暂时不可交互，仍需工作台恢复流程处理。原生 `execCommand('copy')` 已被浏览器标为旧接口；若未来移除，明确内部复制降级保持，届时再评估需要用户确认的 parent 手动复制入口。

回滚：去掉构建 hook 与 iframe 两个 fullscreen 属性后按原流程重新构建；不涉及文稿数据或数据库迁移。
