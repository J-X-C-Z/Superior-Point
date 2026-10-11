# Superior Point 0.1.0 Alpha — 发布候选

发布日期：2026-10-11。预发布候选（pre-release），不是 Stable；本说明不代表路线图全部完成。

## 已部署

- 生产工作台：[https://sp.jxcz.top/](https://sp.jxcz.top/)；独立管理后台：[https://sp.jxcz.top/admin](https://sp.jxcz.top/admin)。
- TypeScript/Fastify API、PostgreSQL 云端工作台、PAT、同库 stdio MCP Bridge。
- 单写者租约、CAS 保存、云端草稿恢复和独立 Admin。
- v0.39 编辑器集成；本地模式支持浏览器 IndexedDB、可编辑 HTML/JSON 备份、导入和 Reveal.js 放映。

## 验收记录

- 真实生产 stdio MCP 浏览器接力完成后，在云端工作台回读已保存的项目内容与会话。
- Chrome 完整进程重启实测：进程 `35168` 退出并确认不存在，再以同一 profile 启动进程 `41891`；会话和保存内容恢复。
- 应用与数据库进程重启恢复已实测通过。为避免影响主机现有业务，未执行整机重启。
- Chrome/Firefox 冻结编辑器候选主路径与完整进程重启见 [SP-016 验收记录](docs/acceptance/sp016-frozen-browser-mainpaths.md)；Edge 与生产云端验收见 [Alpha 验收记录](docs/verification/alpha/acceptance.md)。生产部署读回记录见 [Hakari 验收记录](docs/verification/hakari/acceptance.md)。
- Node 22 CI 已通过：48 项 service 测试、193 项常规测试通过、1 项原有有意跳过，严格类型检查与构建通过。

## 已知范围

- `dist/SuperiorPoint_v0.1.0-alpha.html` 是本地 IndexedDB 单文件模式，不连接云端，也不会自动迁移浏览器中的本地项目。生产云端请使用 https://sp.jxcz.top/。
- 仓库旧式文件 stdio MCP 与浏览器 IndexedDB 相互独立；生产云端 Bridge 使用同一 PostgreSQL。
- 每日生产备份、离机备份及恢复演练由用户延期，不能视为已完成；整机重启未执行。
- 远程 HTTP MCP/OAuth 属于 v0.2，尚未实现。复杂 PPTX 兼容、高级时间线录制和实时多人协同未作承诺。
- 可编辑 HTML/JSON 备份包含完整编辑数据；分享前检查内容。详见 [验证范围](docs/VALIDATION.md)。项目原创代码尚未指定开源许可证；Reveal.js MIT 许可证保留。

冻结编辑器的额外实测范围见 [放映、权限与 PPTX 验收](docs/acceptance/sp016-frozen-presentation-permissions-pptx.md)：窗口放映和独立 file:// 下 Reveal HTML 呈现已通过；集成全屏、媒体录制未通过，工作台 PPTX 导入未接入，PPTX 导出只验过结构子集，同对象脉冲等复杂动画未认证。
