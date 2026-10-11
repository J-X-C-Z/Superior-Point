# v0.1 Alpha 接入契约（2026-10-11）

目标：路线图全部v0.1 P0，浏览器与stdio Bridge共用PostgreSQL ProjectService。原本地模式保留，编辑器功能由“编辑器开发”会话独立负责；不新增远程OAuth/v0.2高级能力。

## 所有权

服务统筹 owns server/app.ts/contracts.ts/db基础迁移及Admin服务/UI/部署；账号子agent owns auth/token-service.ts + 002_tokens.sql/down + tests/service/token-service.test.ts；云端子agent owns storage/cloud-project-store.js、storage/cloud-drafts.js、web/cloud-workspace.js、web/app.js/index.html/entry.js云存储入口，以及相关cloud测试。MCP子agent owns mcp/bridge/ + bridge测试。编辑器会话 owns tools/editor-*、vendor/editor-*的builder产物、web/editor-adapter.js、adapters/、io/和editor/export tests，在原checkout提供commit由统筹整合。

## PAT

Actor新增 tokenId?:string。api_tokens: id uuid default gen_random_uuid PK,user_id FK,token_hash unique,prefix,name,scopes jsonb,project_allowlist jsonb nullable,expires_at,revoked_at,created_at,last_used_at。高熵sp_pat_前缀凭据仅创建响应出现，SHA256验证材料。默认read/create/write/export，无delete；项目allowlistnull允许自己的项目，[]无可访问项目。token可创建时显式scope；到期最多365天，默认30天。TokenService(db): create(actor,{name,scopes?,projectAllowlist?,expiresAt?})->{token,...metadata}; list(actor)->safe[]; revoke(actor,id); authenticate(raw)->Actor(source mcp,tokenId,scopes,projectAllowlist); adminList(admin)->safe[]; adminRevoke(admin,id)。会话管理操作重新验证活动绑定会话，PAT不能管理PAT/Admin。导出作用域projects:export不等于read，不得导出时绕过作用域。

GET/POST /api/v1/me/tokens、DELETE /api/v1/me/tokens/:id；Admin GET /api/v1/admin/mcp/tokens，POST /:id/revoke。API非浏览器Bearer认证请求可不携带Origin/CSRF，但不得混合Cookie/Bearer；提供Origin时只能配置的同源。Cookie仍要求Origin/CSRF。公开路由不得信任source/owner/role输入。ProjectService事务内锁活动token验证到期/吊销，令牌创建无公开注册。

## 云端存储与新项目

POST /api/v1/projects/import {document,clientMutationId} 在ProjectService创建新UUID，revision0，保留未知字段/图片/备注并重建创建身份，将来源ID/revision映射放metadata.spCloudImport，不覆盖现有项目；同用户同clientMutationId可重试返回相同项目，内容不同409。import_receipts独立表记录actor/mutation/hash/project；不将sourceid当云端权威ID。

PUT /api/v1/projects/:id/snapshot {expectedRevision,clientMutationId,document,leaseToken} 是v0.39批量本地编辑过渡入口：只有有效单写者租约可提交；document.id/format/schemaVersion/metadata.createdAt必须和当前库相同；incomingrevision安全整数且大于expectedRevision。Core验证内容与replaceContent，CAS/收据/修订/审计一次事务。允许快照revision跨越未单独落盘的本地编辑修订，以保留既有Core/AutosaveQueue同步契约；服务端结构化PATCH operations仍每次+1。这是明确的批量保存修订契约，不是多人实时协作。相同clientMutationId不确定提交重试返回原结果。

GET /api/v1/projects/:id/document?trash=true 允许owner回读自己回收站文档用于列表预览/恢复，普通GET仍只活跃项目。云端列表返回metadata，CloudProjectStore可逐项有界并发读取详情，不引入第二权威库。

CloudProjectStore提供现有ProjectStore接口 open/close/list/get/create/markOpened/acquire/renew/release/save/setDeleted，record形状{id,document,modifiedAt,openedAt,deletedAt,storage:'cloud'}，lock{id,owner,token,expiresAt}。Acquire遇到PROJECT_BUSY返回null且不允许takeover，读回最新文档才激活写权。get/save canonical修订号真实，未提交草稿独立IndexedDB按账号+project+sourceRevision存储；云端失败不能显示已云端保存，备份/恢复入口保留。基于同文档快照/expectedRevision缓存clientMutationId直到已知结果，盲写冲突禁止重试。新建/导入返回新云ID后由workspace打开record.id，不继续使用源本地ID。

GET /api/v1/auth/me返回{user}（csrf原值不能从哈希恢复，因此sessionCookie刷新后用POST /auth/csrf轮转生成新csrfToken并写哈希，Cookie+Origin保护；仅activeSession）。客户端登录时拿初始csrfToken，页面重开调用csrf刷新。每次轮转不撤销会话但旧csrf失效；另标签写失败显式刷新csrf重试仅未提交403请求，不重试不确定文档写入。

浏览器同源service提供/login,/app,/local,/admin，原web/index local独立构建依然工作。cloud入口通过query模式或服务器注入标记使用CloudProjectStore，原本地库隔离不清空。迁移向导：选本地项目、校验、上传导入、新UUID回读语义比对（仅id/revision/创建时间/来源元信息允许差异），成功标记，保留本地数据。断网保留恢复草稿。交给AI：flush确认持久提交后释放租约转只读；取回编辑先读最新修订，未保存草稿恢复为独立副本，不抢占未落盘草稿。

## MCP Bridge

本地SDK stdio，SP_API_URL=https目标（HTTP仅显式回环dev）、SP_API_TOKEN从环境，不记录。HTTP客户端8原工具+sp_list_projects/info/slides；调用统一项目读/编辑/import/export/leaseAPI，scope/allowlist由服务判定。sp_edit自己申请租约（busy失败）、同ID稳定重试（超时不盲换ID）、释放租约；不能抢占浏览器。本地文件仅显式SP_BRIDGE_ROOT，复用FileStore边界但不创建本地云权威文档，只用其安全readFile/exports功能或等价realpath/符号链接拒绝。sp_save_export服务器POST /projects/:id/exports {expectedRevision,format:'editable-html'|'audience-html'}返回HTML/mime/revision，Bridge仅保存授权root。sp_render_slide GET /projects/:id/slides/:slideId/render，sp_validate GET /projects/:id/validate，sp_get_slide GET /projects/:id/slides/:slideId；所有经ProjectService的对应scope，不能通过read代理绕过export限定。

## Admin & Runtime

/admin独立同源UI；API逐项admin守卫、分页、项目管理仅metadata，用户角色/禁用/密码重置/所有token吊销/设置/备份需短期二次密码认证，审计。Settings允许非机密白名单。备份任务只可调用固定pg_dump/pg_restore程序与任务目录，不接受任意Shell/服务器路径；备份含DB和本地资产，恢复隔离库验证，不能网页覆盖生产库。Compose/Caddy/预检/备份恢复/日志/健康/回滚，Hakari先只读核实，不影响现有服务。首管理员生产凭据与外部TLS发布需要最后具体审阅再批准，禁止默认账号/secret。

幂等收据补充：租约token属于当前写权证明，不属于语义变更哈希。成功提交后的同Actor/项目/变更ID/expectedRevision/内容重放可换租约，仍须当前身份与作用域有效；未提交变更仍须有效租约。这样Bridge进程重启后能够安全重复请求而不二次执行。f1cc67a是发布前本地基础，不迁移其临时测试收据。
