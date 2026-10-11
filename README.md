# Superior Point (SP) v0.0.1

本地优先的演示文稿工作台，集成 v0.39 编辑器。此版本是可试用的早期预览版（pre-release），不是功能完整或生产稳定版。发布版本 v0.0.1 与内部编辑器版本 v0.39 分别编号。

## 最快查看

打开 `dist/SuperiorPoint_v0.0.1.html` 可尝试单文件工作台。不同浏览器对 `file://` 下 IndexedDB 的支持有差异；推荐以下本地服务方式，使用固定端口维持同一存储来源。

需要 Node.js 22+：

```sh
npm ci
npm start
```

浏览器打开 http://127.0.0.1:8787/ 。只绑定本机回环地址，不对局域网开放。无需账号，不上传内容。若修改端口或换浏览器，项目库相互独立。浏览器清理站点数据会删除项目库；重要内容请导出 HTML 备份。

可从首页新建项目、搜索/排序、重命名、复制、移入回收站和恢复，也可导入 `examples/five-slides.html` 查看五页示例。打开项目后进入原 v0.39 编辑界面的候选副本，可使用文字、形状、页面等现有编辑入口。上方工作台负责自动保存、JSON 备份与恢复。打开的项目通过候选原渲染器导出 HTML；首页卡片和 MCP 仍使用基础渲染器。

## 已实现

- 共享 Document Core：JSON 验证、最小版本迁移、原子事务、修订冲突、撤销与重做、独立快照。
- Home 与本地项目库：IndexedDB、自动保存串行队列、错误重试、回收站、单写者租约/接管、保存 CAS 检查。
- 可编辑 HTML：内嵌真实 Reveal.js 5.2.1 与 CSS、惰性 JSON 数据、安全导入，不加载 CDN。
- 基础渲染器：文本、简单形状、连接线、内嵌图片、表格、条形图、appear fragments；高级富文本/复杂动画等仅保留数据，尚未实现最终表现。
- stdio MCP：8 个真实 SDK 工具，范围受限的文件项目库，原子保存和修订冲突。
- v0.39 候选适配：隔离 iframe、单一 Core 提交、统一撤销、关闭旧存储双写、失败快照恢复。
- 独立 v0.32 只读参考检查与无损 JSON 保留实验，未在 UI 启用；图片字节检查和按元素的渲染兼容诊断。

**备份可编辑 HTML / JSON 保留完整编辑数据，包含备注、批注与历史。** 新增“分享观众 HTML”：只含可见页面与放映内容，不包含编辑项目载荷、备注、批注、历史或隐藏页，不能用它重新导入编辑。分享前仍应检查幻灯片上的可见内容。

打开项目后分享使用原编辑器渲染器；首页卡片分享使用基础渲染器；发现已知高级样式或动画缺口时，会在下载前提示打开项目后再分享。

HTML 默认含完整文档，但不包含 AI 对话、MCP 调用记录、账号或凭据。导出拒绝外链资源及脚本/SVG/HTML 等未支持的活动内容，避免把缺图或不安全导出误报为成功。

导入支持本框架的完整 JSON 备份和可编辑 HTML；详细格式、错误恢复及 MCP 文件交接见 `docs/IMPORT.md`。

## 保存失败后的恢复

出现保存冲突或写入权失效时，可导出完整 JSON 备份，或把未保存的内容恢复为独立项目；新副本写入成功前不会丢弃原会话。原项目及其他标签页的内容不被覆盖。操作与文件交接说明见 `docs/RECOVERY.md`。

## MCP

```sh
node mcp/server.js --project-root /absolute/path/to/your/sp-projects
```

第一次运行会创建该目录。请选专用目录，不要给整个个人文件夹。详见 `docs/MCP.md`。本包验证的是 SDK 客户端与服务器的真实 stdio 协议，不是用户 Codex/Claude 账号已连接。

MCP 文件库与浏览器 IndexedDB 是两个存储位置，第一版通过可编辑 HTML 交换文档，**没有实时浏览器同步**。

## 候选限制

Chrome 已实测新建、文字/形状编辑、自动保存、重开、导出重导入、放映、五页内嵌图片及多标签单写。本机新增 IAB 保存重开与恢复、Edge 本地 PNG 插入/拖动/西北手柄缩放/撤销重做验收。完整进程重启与 file:// 放映仍待验收。候选在隔离 iframe 中运行，剪贴板、录制和弹窗能力可能受限；外部网络资源不加载，ZIP 项目包入口暂不接入；PPTX 沿用原导出但本轮未验收其格式兼容。媒体数据保留，但当前安全 HTML 导出仍拒绝音视频和未支持的活动资源，不能将缺失资源默默当成成功。嵌套 Core 组合和组合整体动画会明确拒绝接入，不改原始项目。复杂 native 动画保留原字段与运行时，不宣称与 Core 简化动画完全等价。

详见 `docs/editor-candidate-bridge.md`。候选错误时请保留 JSON 备份；导入执行文件本身不会运行其中脚本。

## 测试与重建

```sh
node tools/build-editor-integration.js
npm run build
node examples/generate.js
npm test
```

浏览器测试需 Python Playwright 及测试中指定的浏览器；先另开终端运行 `PORT=8768 npm start`，再运行 `python3 tests/browser-framework.py`。单文件离线测试见 `tests/html-offline.py`。

测试证据与未验证项见 `docs/VALIDATION.md`。Node 中 fake-indexeddb / JSDOM 的通过结果不等于真实浏览器、重启或视觉验收。

## 目录

- `core/`：共享纯 JS 核心与 TypeScript 声明
- `storage/`：IndexedDB 与自动保存
- `web/`：Home、只读基础预览、editor adapter
- `io/`、`vendor/`：安全 HTML 与 Reveal 离线运行时
- `mcp/`：stdio server 与本地文件库
- `examples/`：五页示例、生成器
- `tests/`：核心、文件、协议、存储、DOM 与浏览器验收脚本

本轮不开发主题系统、账号、云同步、PPTX 新能力、实时 MCP 配对或独立 `.sp` 文件格式。

## 许可

此仓库尚未为项目原创代码指定开源许可证。公开可见不等于授予任意使用、修改或再分发许可。第三方 Reveal.js 的 MIT 许可证保留在 `vendor/REVEAL-LICENSE`。
