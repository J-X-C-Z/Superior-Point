# Superior Point (SP) 0.1.0 Alpha

演示文稿工作台，集成 v0.39 编辑器。`0.1.0-alpha` 是可试用的预发布候选，不代表稳定版或完整路线图交付；产品版本与内部编辑器版本分别编号。

## Alpha 候选已部署

Alpha 候选已部署到 [sp.jxcz.top](https://sp.jxcz.top/)，管理入口为 [/admin](https://sp.jxcz.top/admin)。部署包括 API、PostgreSQL、云端工作台、PAT、连接同一 PostgreSQL 的 stdio MCP Bridge、单写者租约、CAS 草稿与恢复、独立 Admin。此版本作为 **pre-release 候选**发布，不是 Stable，也不代表路线图全部完成。

生产浏览器验收包含真实 MCP 接力后在浏览器回读，以及同一 Chrome profile 的完整进程重启后恢复会话和项目内容；编辑器 Chrome/Firefox 主路径也完成独立进程重启验收。Node 22 的 CI 已通过：48 项 service 测试、193 项常规测试通过，1 项原有有意跳过，严格类型检查与构建通过。详见 [Alpha 验收记录](docs/verification/alpha/acceptance.md)、[Chrome/Firefox 编辑器验收](docs/acceptance/sp016-frozen-browser-mainpaths.md) 和 [Hakari 生产验收记录](docs/verification/hakari/acceptance.md)。

生产每日备份和离机备份/恢复演练由用户明确延期，**目前不作为已完成的生产备份保障**。未执行整机重启，以免影响主机现有业务；应用和数据库进程的重启恢复已有实测通过记录。OAuth/OIDC、远程 HTTP MCP 尚未实现，属于 v0.2 范围。

服务环境、首次管理员初始化、迁移和隔离测试参数见 [服务与运维指南](docs/admin/service-operations.md)；面向用户的账号、项目和 Bridge 使用说明见 [用户指南](docs/user/service-guide.md)。完整接口以 [OpenAPI](docs/api/openapi.yaml) 为准。

本仓库当前工作区还包含独立主题库和项目历史接口；本次未执行线上部署，因此不能据此认定生产站点已更新。主题创建、编辑、版本、导入导出和应用说明见[主题库指南](docs/THEMES.md)，兼容性范围见[主题验收记录](docs/acceptance/theme-compatibility.md)。

## 最快查看

打开 `dist/SuperiorPoint_v0.1.0-alpha.html` 可尝试单文件工作台。该文件运行**本地模式**并使用浏览器 IndexedDB；它不会连接生产云端，也不会自动迁移已有浏览器项目。云端模式请访问 [sp.jxcz.top](https://sp.jxcz.top/)。不同浏览器对 `file://` 下 IndexedDB 的支持有差异；推荐以下本地服务方式，使用固定端口维持同一存储来源。

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
- 独立主题库（本仓库当前代码）：6 个只读内置主题、个人本地/云端主题、固定版本、JSON 导入导出，以及保留手工覆盖或明确重置的主题应用。
- 本地 stdio MCP：8 个真实 SDK 工具和范围受限的文件项目库。云端 stdio MCP Bridge：16 个工具，其中 5 个用于主题；主题访问需单独授予 `themes:read`、`themes:write` 或 `themes:publish`。
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

旧式本地 stdio MCP 使用独立文件项目库，与浏览器 IndexedDB 分开，通过可编辑 HTML 交换文档；它不会自动同步或接管浏览器数据。云端 stdio MCP Bridge 通过 PAT 接入与云端工作台相同的 PostgreSQL，并遵循项目白名单、单写者租约与版本冲突检查。主题工具另外需要显式主题范围；主题预览为静态 SVG，字体和图表可能降级。远程 HTTP MCP、OAuth/OIDC 尚未实现。

## 候选限制

Chrome/Firefox 编辑器主路径和完整浏览器进程重启证据见 [SP-016 验收记录](docs/acceptance/sp016-frozen-browser-mainpaths.md)；生产云端与 Edge 验收见 [Alpha 验收记录](docs/verification/alpha/acceptance.md)。单文件预览仍是本地模式，不能据此推断云端连接或 IndexedDB 迁移。复杂 PPTX 保真、完整高级时间线与录制、实时多人协同均不在本次承诺范围；远程 HTTP MCP/OAuth 属于 v0.2。外部网络资源不加载，ZIP 项目包入口暂不接入。媒体数据可保留，但当前安全 HTML 导出仍拒绝音视频和未支持的活动资源。嵌套 Core 组合和组合整体动画会明确拒绝接入，不改原始项目；复杂 native 动画保留原字段与运行时，不宣称与 Core 简化动画完全等价。

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

0.1.0 Alpha 提供云端账号、工作台与同库 MCP Bridge；不包含远程 HTTP MCP/OAuth、复杂 PPTX 能力、完整高级时间线录制、实时多人协作或独立 `.sp` 文件格式。它是预发布候选，不是 Stable。

## 许可

此仓库尚未为项目原创代码指定开源许可证。公开可见不等于授予任意使用、修改或再分发许可。第三方 Reveal.js 的 MIT 许可证保留在 `vendor/REVEAL-LICENSE`。

冻结编辑器的额外实测范围见 [放映、权限与 PPTX 验收](docs/acceptance/sp016-frozen-presentation-permissions-pptx.md)：窗口放映和独立 file:// 下 Reveal HTML 呈现已通过；集成全屏、媒体录制未通过，工作台 PPTX 导入未接入，PPTX 导出只验过结构子集，同对象脉冲等复杂动画未认证。
