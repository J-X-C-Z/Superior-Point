# REST 错误契约

本文件对应 `server/app.ts`、`server/contracts.ts`、`server/auth/auth-service.ts` 与 `server/services/project-service.ts` 当前返回的错误。服务响应采用 `{error:{code,message,details?}}`；未预期服务端错误还带顶层 `requestId`。内部 SQL/数据库错误不会放入响应。

| HTTP | 错误码 | 当前触发条件 |
|---:|---|---|
| 400 | `INVALID_REQUEST` | Fastify body schema、业务字段、用户名格式、路径用户 ID、`trash` 查询值或 Document Core 操作无效；也包括文档超过 32 MiB 或标题超过 500 字符 |
| 401 | `UNAUTHENTICATED` | 缺少、过期、已撤销或属于已禁用账户的会话；错误消息为“请先登录” |
| 401 | `INVALID_CREDENTIALS` | 用户名不存在、密码错误或账户已禁用；统一返回“用户名或密码错误” |
| 403 | `INVALID_ORIGIN` | 写请求的 `Origin` 与配置源不完全相同 |
| 403 | `CSRF_INVALID` | Cookie 写请求未提供 `X-CSRF-Token` |
| 403 | `FORBIDDEN` | 角色不允许、未知/不匹配 CSRF token、或其他授权检查拒绝请求 |
| 404 | `NOT_FOUND` | 用户不存在，或项目不存在/已删除/不归当前 Actor 所有；后几种项目情况统一响应 |
| 409 | `REVISION_CONFLICT` | mutation 的 `expectedRevision` 与当前项目版本不一致 |
| 409 | `MUTATION_ID_REUSED` | 同一 Actor 和项目复用 `clientMutationId`，但请求内容不同 |
| 409 | `PROJECT_BUSY` | 项目存在另一 Actor 的有效写租约 |
| 409 | `LOCK_LOST` | 写入提供了失效、不属于当前 Actor 或已过期的租约，或快照提交缺少租约 |
| 409 | `LAST_ADMIN` | 禁用或降级操作会移除最后一个有效管理员 |
| 409 | `USERNAME_EXISTS` | 创建用户时用户名已占用 |
| 409 | `BOOTSTRAP_COMPLETE` | 本地 bootstrap 已有用户记录；这是初始化服务结果，不是 HTTP 路由 |
| 413 | `PAYLOAD_TOO_LARGE` | HTTP 请求体超过 Fastify 的 32 MiB 限制 |
| 429 | `RATE_LIMITED` | 登录来源 IP 超过配置的尝试次数；响应带 `Retry-After` |
| 500 | `INTERNAL_ERROR` | 未预期服务端异常；响应只带通用消息和 `requestId` |

## 认证与授权语义

- 登录输入需满足用户名 3～64 字符、密码 1～1024 字符。账户创建要求用户名匹配 `^[A-Za-z0-9_.-]{3,64}$`，密码为 12～1024 字符。
- 写请求在身份验证前检查精确 Origin。Cookie 写请求随后校验 CSRF；缺少 token 返回 `CSRF_INVALID`，错误 token 当前映射为 `FORBIDDEN`。
- 对项目资源，其他用户的项目 ID 与不存在/已删除的项目 ID 均为 `404`，避免暴露项目存在性。
- 已知 `ServiceError` 保留其状态码与错误码；Fastify schema 错误映射为 `400 INVALID_REQUEST`，请求体过大映射为 `413 PAYLOAD_TOO_LARGE`。未识别异常映射为 `500 INTERNAL_ERROR`。
- 修订冲突与租约错误失败关闭；幂等重放返回原提交结果，不增加修订。不要自动重试带旧 `expectedRevision` 的写入。
