# SP-001 基础服务契约（2026-10-11）

本轮范围：SP-001～007，服务化路线图第1批及本地管理员初始化。保留原本地编辑器和stdio文件模式。后续云端编辑器适配、PAT/Bridge、管理后台和Hakari部署独立验收。

Node 22+ / TypeScript / Fastify 5 / PostgreSQL。服务只信任鉴权得到的 Actor：`{id,role,source,sessionId?}`。用户角色不带来读取其他用户正文的权限。管理项目元数据与私人正文接口分离。服务错误统一 `{error:{code,message,details?}}`，内部数据库错误不得返回客户端。

身份：`POST /api/v1/auth/login {username,password}`，返回 `{user:{id,username,role},csrfToken}` 和 HttpOnly 会话Cookie；`GET /auth/me`，`POST /auth/logout`。写请求校验精确 Origin，Cookie会话要求 `X-CSRF-Token`。生产Cookie Secure；HTTP仅显式开发模式。无公开注册或bootstrap API。

项目：`GET/POST /api/v1/projects`，创建 `{title?,canvas?}` 返回 canonical document；`GET /projects/:id/document` 返回 document；`PATCH /projects/:id/document {expectedRevision,clientMutationId,operations,leaseToken?}`。Core使用真实 `properties` 字段，不使用规划示例中的patch。操作1～1000项。快照replaceContent必须持有租约，其他写入也不得绕过有效租约。读写均限定 owner_id = Actor.id；不存在与他人项目统一404。

`PATCH /projects/:id {title,expectedRevision,clientMutationId}` 重命名（服务内部Core事务）；`DELETE /projects/:id` 与 `POST /projects/:id/restore` 使用 `{expectedRevision,clientMutationId}`。列表 `?trash=true`。变更使用行锁+CAS、修订、审计、收据同一事务。相同actor+project+clientMutationId+相同请求返回原提交结果；复用ID且内容不同返回409 MUTATION_ID_REUSED。每次成功变更revision只增1。

租约：`POST /projects/:id/lease {holder}`；`POST /projects/:id/lease/renew {leaseToken}`；`DELETE /projects/:id/lease {leaseToken}`。holder仅客户端会话标识，不是授权依据；数据库锁归actor，token高熵不可猜。租约60秒，禁止主动抢占活动租约，PROJECT_BUSY与LOCK_LOST均409。快照失去租约时不提交。

数据库001包含 users(id UUID,username unique,password_hash,role admin/user,status active/disabled,created_at), sessions(id UUID,user_id,session_hash unique,csrf_hash,expires_at,revoked_at,created_at), projects(id UUID,owner_id,title,revision bigint,document_jsonb,deleted_at,updated_at), project_revisions(project_id,revision,actor_id,source,document_jsonb,created_at), project_locks(project_id PK,actor_id,holder,fencing_token UUID,expires_at), mutation_receipts(project_id,actor_id,client_mutation_id,request_hash,result_jsonb,created_at), audit_logs(id bigint,actor_id,action,resource_type,resource_id text,outcome,created_at)。角色/admin不绕过项目owner检查。审计不含正文或凭据。

AuthService(db,{sessionTtlMs?,secureCookies?,origin?})提供 bootstrapAdmin(username,password), createUser(actor,{username,password,role?}), setUserStatus(actor,id,status), setUserRole(actor,id,role), revokeUserSessions(actor,id), login(username,password), authenticate(sessionToken), logout(sessionToken), getUser(actor)。login返回 `{user,sessionToken,csrfToken,expiresAt}`；authenticate返回Actor，调用方负责会话Cookie与Origin/CSRF。CSRF校验service提供 verifyCsrf(actor,token)。用户禁用立即拒绝会话，最后有效管理员保护与角色变更在事务中执行。

ProjectService(db)提供 create(actor,options), list(actor,{trash?}), get(actor,id), edit(actor,id,{expectedRevision,clientMutationId,operations,leaseToken?}), remove/restore(actor,id,{expectedRevision,clientMutationId}), acquireLease(actor,id,holder), renewLease(actor,id,leaseToken), releaseLease(actor,id,leaseToken)。所有服务返回持久提交结果。

测试使用隔离本机PostgreSQL，不能访问现有Paperclip/Hakari数据库。迁移加事务/校验和/锁。回滚只在显式隔离测试库完成，生产数据操作另行授权。
