# 云端 stdio MCP Bridge

`node mcp/bridge/server.js --root /absolute/real/authorized/directory` 使用真实 MCP SDK stdio。配置 `SP_API_URL=https://你的服务域名`、环境变量 `SP_API_TOKEN`；禁止在参数、日志或配置示例中放真实 PAT。`SP_BRIDGE_ROOT` 可替代 `--root`。目录必须预先存在、无符号链接。只读云端工具不需要本地目录。

回环开发服务可显式设置 `SP_BRIDGE_ALLOW_HTTP=1`；HTTP 仅允许 localhost、127.0.0.1、::1。API URL 必须是 origin，不带路径、认证信息、查询或片段。重定向被拒绝，防止凭据转发。

保留八个原工具：`sp_create_project`、`sp_open_project`、`sp_get_document`、`sp_get_slide`、`sp_edit`、`sp_render_slide`、`sp_validate`、`sp_save_export`；增加 `sp_list_projects`、`sp_project_info`、`sp_list_slides`。权限、项目范围和吊销由云服务判断。原 `mcp/server.js` 本地模式保持独立。

新建/HTML 导入返回服务端新 canonical UUID；`projectId` 新建参数只作为来源提示，不指定云端身份。HTML 导入复用 `readImportFile`，仅提取已有安全 inert 文档信封，不执行脚本。文件名必须为单层简单 `.html` 名称、不能包含 `..`；读取/导出拒绝符号链接。导入最多 25 MiB，导出最多 32 MiB。Bridge 不在本地创建项目 JSON 或文档权威副本。

`sp_edit` 要求 `expectedRevision` 和 operations，可指定 `clientMutationId`。先获取租约，遇到 PROJECT_BUSY 立即失败。传输失败或服务器 5xx 最多自动重试一次，使用同一 mutation ID、同一 payload 与 lease token；最后尝试释放租约。未确认结果时，错误返回 mutation ID；同一 Bridge 进程内再次提交原参数保留原提交身份。明确指定的 mutation ID 不能配不同内容。重启后无法恢复内存中的未确认请求，应先回读修订、核对结果，禁止换 ID 盲重试。

`sp_save_export` 只请求服务端 `{expectedRevision,format}`（editable-html 默认，或 audience-html），校验响应修订后原子保存服务返回的 HTML，不在本地重新渲染。服务端按 export 权限验证，read 权限不能代替 export。

验证：`node --test tests/mcp-bridge.test.js` 检查真实 stdio + HTTP 假服务传输边界和相同 payload 重试；`TEST_DATABASE_URL=回环独立测试库 node --import tsx --test tests/service/mcp-bridge.test.ts` 检查真实 stdio→HTTP→PAT→PostgreSQL。两者不代表浏览器或生产部署验收。
