# 云端 stdio MCP Bridge

`node mcp/bridge/server.js --root /absolute/real/authorized/directory` 使用真实 MCP SDK stdio。配置 `SP_API_URL=https://你的服务域名`、环境变量 `SP_API_TOKEN`；禁止在参数、日志或配置示例中放真实 PAT。`SP_BRIDGE_ROOT` 可替代 `--root`。目录必须预先存在、无符号链接。只读云端工具不需要本地目录。

回环开发服务可显式设置 `SP_BRIDGE_ALLOW_HTTP=1`；HTTP 仅允许 localhost、127.0.0.1、::1。API URL 必须是 origin，不带路径、认证信息、查询或片段。重定向被拒绝，防止凭据转发。

保留八个原工具：`sp_create_project`、`sp_open_project`、`sp_get_document`、`sp_get_slide`、`sp_edit`、`sp_render_slide`、`sp_validate`、`sp_save_export`；增加 `sp_list_projects`、`sp_project_info`、`sp_list_slides`。权限、项目范围和吊销由云服务判断。原 `mcp/server.js` 本地模式保持独立。

新建/HTML 导入返回服务端新 canonical UUID；`projectId` 新建参数只作为来源提示，不指定云端身份。HTML 导入复用 `readImportFile`，仅提取已有安全 inert 文档信封，不执行脚本。文件名必须为单层简单 `.html` 名称、不能包含 `..`；读取/导出拒绝符号链接。导入最多 25 MiB，导出最多 32 MiB。Bridge 不在本地创建项目 JSON 或文档权威副本。

`sp_edit` 要求 `expectedRevision` 和 operations，可指定 `clientMutationId`。对象级原子操作不获取租约：同一账号的浏览器保持编辑时，Agent 可直接按最新修订提交，服务端仍以事务锁与 CAS 串行确认。包含 `replaceContent` 的整篇替换仍先获取排他租约，遇到 PROJECT_BUSY 立即失败。传输失败或服务器 5xx 最多自动重试一次，使用同一 mutation ID、同一 payload 与 lease token；整篇替换完成后尝试释放租约。未确认结果时，错误返回 mutation ID；同一 Bridge 进程内再次提交原参数保留原提交身份。明确指定的 mutation ID 不能配不同内容。重启后无法恢复内存中的未确认请求，应先回读修订、核对结果，禁止换 ID 盲重试。

`sp_save_export` 只请求服务端 `{expectedRevision,format}`（editable-html 默认，或 audience-html），校验响应修订后原子保存服务返回的 HTML，不在本地重新渲染。服务端按 export 权限验证，read 权限不能代替 export。

验证：`node --test tests/mcp-bridge.test.js` 检查真实 stdio + HTTP 假服务传输边界和相同 payload 重试；`TEST_DATABASE_URL=回环独立测试库 node --import tsx --test tests/service/mcp-bridge.test.ts` 检查真实 stdio→HTTP→PAT→PostgreSQL。两者不代表浏览器或生产部署验收。

浏览器自动读回已确认修订。双方修改不同字段或对象时三方合并；同一字段、删除与修改、同时更改数组顺序不自动裁决，保留本地草稿并提示恢复副本。同步远端版本会重置撤销历史，防止撤销覆盖 AI 已提交的内容。本地离线模式不连接云端 Agent。

主题工具增加 `sp_list_themes`、`sp_get_theme`、`sp_preview_theme`、`sp_apply_theme`、`sp_save_theme`。列表合并只读内置主题和用户私人云端主题；读取固定版本返回 `{id,version,hash,snapshot}`。预览只渲染服务端原创多页样例，返回静态 SVG 和字体/图表降级限制，不读取用户文稿。

查询/预览需 `themes:read`，保存新主题需 `themes:write`，发布现有主题的新版本需 `themes:publish`。应用同时需 `projects:write` 与 `themes:read`，不要求额外项目读取权限，项目 allowlist 仍生效。`sp_apply_theme` 输入 `projectId, expectedRevision, themeId, version, hash, mode, clientMutationId?`；默认 preserve 保留手工样式；reset 由调用方在确认后选择。服务端验证固定主题哈希/私人归属，再以现有 Core 原子批次、CAS 和幂等回执提交；同账号 Agent 使用与普通原子编辑相同的活动浏览器租约规则。旧请求重放返回原结果，不基于新文稿重新计算主题计划。

`sp_save_theme` 输入安全 `theme` 和可选 `clientMutationId`；新建导入返回新云端 UUID。指定 `themeId` 与 `expectedRevision` 时发布不可覆盖的新版本，需对应 scope。应用/保存发生响应丢失时沿用原 mutation ID 和原 payload 重试。默认 Token scopes 不自动包含主题权限。本阶段仍是本地 stdio Bridge，不新增公网 MCP 网关或 OAuth。

主题纵向验证：`TEST_DATABASE_URL=回环独立测试库 node --import tsx --test tests/service/theme-mcp.test.ts`，覆盖真实 SDK→stdio→HTTP→PAT→PostgreSQL 查询、样例预览、私人导入、版本发布、活动浏览器租约下主题应用、回执、CAS、私人 ACL、项目范围及吊销。

历史工具新增 `sp_list_revisions`、`sp_get_revision`、`sp_revision_diff`、`sp_restore_revision`。前三者需要 `projects:read` 并受项目范围约束；恢复需要 `projects:write`、`expectedRevision` 和显式 `clientMutationId`。恢复先尝试取得相同请求的幂等回执；新恢复会通过现有接口获取排他租约，浏览器持有写入权时返回 PROJECT_BUSY，完成后尝试释放。恢复生成新修订，不重写历史；未确认结果仍按相同 mutation ID 与原 expectedRevision 重试。差异是保存修订的对象 ID、主题/资源变化诊断，不等于渲染预览。当前没有独立素材读写服务，不提供虚构的资源上传工具。HTTP/OAuth 的当前开发状态另见 http.md 与 oauth.md；本指南的文件根目录规则仅适用于 stdio Bridge。

主题增量工具：`sp_preview_theme_application` 接收固定主题引用、`projectId`、可选 `mode,slideIds,expectedRevision`，返回保存修订上的非持久化计划、样式差异、手工覆盖与动效诊断；需要 `projects:read` + `themes:read`。`sp_validate_theme_compatibility` 接收 `projectId`，读取已保存主题快照的渲染/导出限制，也需要这两个 scope。`sp_apply_theme` 新增可选非空、不重复的 `slideIds`，范围进入 CAS 幂等指纹；未选择页面不变。`sp_list_themes` 可用 `query` 搜索当前授权列表的名称、ID、标签。
