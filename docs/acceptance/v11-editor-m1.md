# v1.1 编辑器批次 SP-058 / SP-064 / SP-065 与 SP-052 接口

2026-10-11，本地未提交交付；分支 `ui/account-menu`，基线 HEAD `73bc6f721adc580eadc0912092bcadffcd94e352`。未部署，未修改统筹拥有的宿主、主题 schema/library 或本轮 Core。旧协同编辑改动与其他并行工作均保留。

## 可维护源码交付

- `tools/editor-permissions.js`：全屏在异步 Reveal 初始化之前请求；失败明确降级。复制使用用户激活的原生 copy，失败保留内部副本。粘贴用短命 textarea 接收真实系统事件；手动纯文本使用无 form 的 click 路径，符合现有 sandbox/CSP。
- `tools/editor-object-stability.js`：选择去重、右键选择完整组合、层级与取消组合遵守锁、持久画布节点获得键盘焦点；单/多页复制复用原生 remap，并同步 Core 组合/动画/批注/连接器引用。
- `adapters/editor-v038-model.js`：Core 组合锁投影到 native 子对象，往返恢复原子对象自己的 locked 缺省或 false，不固化继承锁。
- `web/legacy-editor-adapter.js`：仅委派 `fullscreen *` / allowfullscreen；sandbox 仍为 `allow-scripts allow-downloads`。主题导航验证来源/channel/epoch/revision/readOnly；当前主题名/版本从 canonical snapshot 读回。
- `tools/editor-theme-entry.js` 与 `tools/editor-bridge.inc.js`：设计选项卡“浏览主题库”/“应用库主题”发同一 themes 命令，先 flush，再交给 `context.onThemes`。原设计预设标为文稿内样式，不另造主题权威；ref/bindings 在普通编辑往返保留。
- builder hook 顺序：可信播放提取后 `patchObjectStability` → `patchEditorPermissions` → `patchEditorThemeEntry`，然后组装 bridge。权限补丁会改变对象补丁所依赖的原文边界，顺序不能反转。

源码参考 vendor SHA256 保持 `74ae7d23c75e294d0821a2a89de1ee9068395f3dd050c27e1621c2ec62e76a6b`。所有生成测试仅写 `/private/tmp/sp-v11-editor-preview`，未覆盖共享 vendor/generated/dist。最终统一构建由统筹完成。

## 自动化证据

cwd 为该 Superior-Point checkout。命令：

`node --test tests/editor-object-stability.test.js tests/editor-permissions.test.js tests/editor-theme-entry.test.js tests/editor-model.test.js tests/editor-adapter.test.js`

退出码 0，30/30，无跳过。包括真实 native handler 的选择/层级/组/复制页操作、剪贴板事件路由、writer/换页保护、拒绝与无权限降级、snapshot 与未知数据往返、theme bridge 验证。另 `git diff --check` exit 0。

临时编译是实际 integration builder 的独立输出重定向，最终输出在 2026-10-11 21:03 CST 前完成：61 个补丁、1,599,846 字节，临时 module SHA256 `4e563ce87b18b1ed732629c7db94aa3a3079898ee8d0f5416b69a76e1286b3ab`。构建、夹具与截图保留在 `/Users/jxcz/Documents/Codex/2026-10-11/https-github-com-j-x-c/outputs/v11-editor/`；端口 8794 仅回环。夹具挂载实际 adapter/Core/native editor，显示 Core 回读；不代表宿主云端持久化验收。

## 真实鼠标/键盘验收

浏览器：本机 Google Chrome for Testing 151.0.7922.34，CUA 原生应用操作，实际 URL `http://127.0.0.1:8794/`。

| 路径 | 实际结果 | 证据 |
| --- | --- | --- |
| 点击放映 → 真正全屏 → Escape | Chrome 自身显示退出全屏提示；Escape 回到编辑器 | chrome-fullscreen.png |
| 鼠标选 A、Shift 选 B/C；顶端对齐/横向分布 | Core r1：a/b y140；r2：b.x440 | 原始 Chrome AX 验收过程与记录 |
| 组合 → Right → Cmd+Shift+G | Core r3/r4/r5；三个对象共同 x+1，再取消组合 | chrome-group-keyboard.txt |
| 新文稿直接点击画布 → Right | 无需先点功能区，Core r1 a.x91 | chrome-canvas-focus-keyboard.txt |
| 系统复制对象 → 外层 textarea Cmd+V | 实际 SUPERIORPOINT_OBJECTS_V1 负载被系统粘贴回读 | chrome-system-object-copy.txt |
| 另一个文稿 Cmd+V | 内部剪贴板为空时仍由系统负载产生新 ID，Core r2 对象从 3→4 | chrome-cross-document-paste-final.txt |
| 外层真实复制普通文本 → Cmd+Shift+V 对话框 → Cmd+V → 插入 | 字段显示测试文字；Core r3 新文本对象；成功反馈 | chrome-manual-paste-final.txt |
| Core 锁定组合的鼠标拖动、Right、取消组合 | r0 不变，明确锁定提示 | chrome-core-group-lock.txt/png |
| 锁定组合复制页 → 在新页移动 | Core 接受 r1，2/2 页；复制后的组合仍锁定，不继续加修订 | chrome-locked-group-slide-copy-final.txt/png |

系统复制拒绝/无 userActivation/超限、全屏拒绝、手动输入取消/会话失效的降级已有单元证据，未冒充浏览器真实权限拒绝验收。

## 未完成与契约限制

Firefox 未完成真实操作验收：本机原先没有可控制的 Firefox。Mozilla 官方下载包 157.0.1 的 SHA512 与官方 SHA512SUMS 相符，但严格 codesign 校验报 invalid signature；未修改签名或系统安全设置。正常请求 CUA 使用 Firefox 返回 `Computer Use was not approved to use Firefox`。未绕过此应用控制许可。SP-058/065 的 Chrome+Firefox 完整 DoD 因此仍开放。

SP-052 源码/消息与快照显示自动化已就绪；真实主题应用、保存/重开/撤销和宿主导航由统筹统一构建后验收。本批次不把夹具回调当作库已应用。

已核对 adapter 会保留 themeRole/themeLayout/ref/bindings；现 v0.39 仍以 bold 表现字重、以 cornerRadius 表现圆角，canonical fontWeight/radius 的数值精度未在本批次扩展。themeLayout 是保留字段，不能据此承诺完整布局引擎。旧 native 预设产生的显式字段应由统一主题应用的 preserve 规则视为手工覆盖；bindings 不会因普通编辑被清除。

## 合并交付冻结

统筹接管后分支已读回为 `roadmap/v1.1-foundation`，HEAD 仍为基线 `73bc6f721adc580eadc0912092bcadffcd94e352`；本批次未建立独立提交。源码已冻结，后续只读调查不修改实现。

当前共享 `vendor/editor-integrated.js` 与本批次最后实际浏览器验收的隔离 candidate HTML 逐字相同，61 patches；HTML SHA256 与 manifest 一致：`13161e5c32e02315ceac807855971e47bc13ece1212d2fb74ce8b514701c36cf`。比对命令退出码 0，`git diff --check` 退出码 0。统筹报告的完整 suite 251 pass / 1 skip、服务 57 pass 属于统筹验收层，本编辑器批次直接执行证据仍为上述 30/30 定向检查与 Chrome 实测。

冻结实现文件：`adapters/editor-v038-model.js`、`web/legacy-editor-adapter.js`、`tools/editor-bridge.inc.js`、`tools/build-editor-integration.js`、`tools/editor-object-stability.js`、`tools/editor-permissions.js`、`tools/editor-theme-entry.js`。测试配套：`tests/editor-model.test.js`、`tests/editor-adapter.test.js`（已有回归）、`tests/editor-object-stability.test.js`、`tests/editor-permissions.test.js`、`tests/editor-theme-entry.test.js`。验收与本地任务文件随批次交付。共享产物已由统筹统一生成；本批次不再启动共享构建。

未验收范围维持开放：Firefox 真全屏/Escape、真实鼠标键盘对象流程、系统与跨文稿剪贴板；Chrome 实际系统权限拒绝场景仅有模拟降级证据；SP052 主题库宿主导航与真实应用/保存/重开/撤销由统筹验证。不得将这些范围标为本批次实测通过。无部署、主机重启或备份动作。
