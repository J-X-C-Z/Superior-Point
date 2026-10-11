# 服务基础状态台账

范围为路线图 v1.0 的 SP-001～SP-007。状态栏只记录可复核的实现和验证证据；本台账不把计划、文档存在或局部代码当成端到端完成证明。

| 任务 | 范围 | 当前证据 | 验证状态 |
|---|---|---|---|
| SP-001 | 服务边界、角色矩阵、REST/OpenAPI、错误格式 | 文档已与实际HTTP路由/字段核对，YAML和内部引用结构检查通过 | 本地通过；待远端CI/合并 |
| SP-002 | PostgreSQL schema、迁移、隔离库初始化与回滚 | 新建/重放/校验和漂移拒绝/事务失败/隔离回滚重建通过 | 本地通过；待远端CI/合并 |
| SP-003 | ProjectService CRUD与owner隔离 | 实际PostgreSQL与HTTP跨用户拒绝访问通过 | 本地通过；待远端CI/合并 |
| SP-004 | Core、CAS、幂等、租约、修订与审计 | 并发CAS、重放、租约、审计故障回滚、进程重启持久化通过 | 本地通过；待远端CI/合并 |
| SP-005 | 认证、会话、CSRF和账户状态 | Argon2id、哈希会话、Cookie、Origin/CSRF、登录限流通过 | 本地通过；待远端CI/合并 |
| SP-006 | RBAC、隔离、撤销与最后管理员 | 越权/伪造拒绝、会话撤销竞争、最后管理员并发保护通过 | 本地通过；待远端CI/合并 |
| SP-007 | 本地bootstrap及Admin创建用户 | 实际CLI标准输入初始化与重复拒绝、账号创建API通过 | 基础通过；完整后台另属SP-031 |

## 通过条件

- **SP-001**：实现路由、请求/响应 schema、权限、Origin/CSRF 与错误码均符合冻结 OpenAPI；OpenAPI 3.1 结构校验通过。
- **SP-002**：全新隔离 PostgreSQL 可执行迁移并校验 schema；事务、锁与回滚验证均只触及测试库。
- **SP-003**：项目增删改查/恢复可用；不同用户的项目 ID 返回与不存在相同的 `404`；Admin 也不能绕过 owner 检查读取正文。
- **SP-004**：同一 mutation 重试不重复提交；不同内容重用 mutation ID 返回 `409`；revision 冲突和租约失效均不产生部分写入；每次成功变更 revision 恰增一。
- **SP-005/006**：登录/退出、过期与撤销会话、禁用用户、CSRF/Origin 拒绝、Admin-only 管理路由和最后管理员约束均有自动化证据。
- **SP-007**：bootstrap 只在本地/受控初始化入口运行；不存在未认证 HTTP bootstrap 或公开注册路径；Admin 创建普通用户成功。

本次实际证据见 [服务基础验收](../verification/service-foundation/acceptance.md)：22服务测试通过，159旧版通过、1原有跳过，TypeScript/构建通过。云端Web、PAT/MCP Bridge、Admin UI、Hakari部署与发布按后续批次验收。
