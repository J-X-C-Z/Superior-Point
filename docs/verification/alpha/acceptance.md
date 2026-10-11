# v0.1 Alpha 候选实现与验收 — 2026-10-11

这是代码与本地验收交付，不是生产发布声明。按路线图 v1.0 推进 v0.1 P0；v0.2 OAuth/远程 MCP、设计系统和 PPTX 新能力未纳入本轮。正式 Alpha 仍受部署和发布门槛约束。

## 交付对象

工作目录：`/Users/jxcz/.codex/.chatgpt-projects/g-p-6acaf26c67908191983e413a278752ce/Superior-Point`，分支 `service-foundation`。

实现提交 `d6b2c1c`；编辑器整合 `23ab972`、`834d54b`、`7fba66b`；构建产物提交 **`7d1f765fd979f012c35a3e63a08fcc07fe172765`**。其源代码与下面最终验收一致，文档归档另作提交。原编辑器工作树和用户已有待恢复标签保持原状；子任务由 6.1 Sol medium 和 6 Luna high 按用户指定并行执行。

## 已实现与本地验证

| 路线图 | 结果与证据边界 |
|---|---|
| SP-001～007 | 契约、4份迁移、统一 Project Service/Core、CAS、账号、会话、RBAC、bootstrap、跨用户隔离；真实 PostgreSQL 回归 |
| SP-008～009 | 登录/本地云端切换、现有编辑器云保存、草稿分支、迁移新身份和回读、原本地项目保留；真实 HTTP/PostgreSQL 与 DOM 测试，Edge 保存/刷新实测 |
| SP-010～012 | PAT/Scope/allowlist/撤销；真实 SDK stdio→HTTP→PAT→PostgreSQL；移交前 flush、释放租约、AI 修改后浏览器读取同一修订；冲突、未知提交去重、独立恢复 |
| SP-029～037 | 独立后台、用户/项目元数据/授权/审计/白名单配置/概览/备份；近期密码验证，管理正文默认不可读；真实 API、DOM 及 Edge 后台概览 |
| SP-013～015 | Compose/Caddy/Linux 构建包、独立 DB 角色、固定备份 CLI、每日调度与可选 Restic 接口、健康与安全响应头；真实受限角色初始化、迁移和恢复通过。容器/HTTPS/定时/离机运行仍待生产验收 |
| SP-016 | 本地集成与 Edge 路径通过；编辑器隐藏预览/失去写权后继续拖动已修。Chrome/Firefox、剩余编辑器兼容矩阵、正式 CI/部署/发布仍未完成 |

图片的当前权威内容沿用文稿内嵌数据；独立资产目录随备份保留并校验。本轮不声称已实现 v0.3 素材库。

## 命令与原始输出

环境为 Node 26.8.1、独立 PostgreSQL 18.1 集群，回环 `127.0.0.1:55439`，测试库 `sp_foundation_test`；每测试随机 schema，自行清理。备份客户端为官方 libpq PostgreSQL 18.6。没有连接生产业务数据库。

| 执行 | 退出码 | 结果 / 原始输出 |
|---|---|---|
| `npm test`（编辑器修复整合后） | 0 | 194 项，193 通过，1 原有跳过；[完整输出](unit-tests.log) |
| `TEST_DATABASE_URL=postgresql://sp_test@127.0.0.1:55439/sp_foundation_test SP_TEST_PG_BIN=/opt/homebrew/opt/libpq/bin npm run test:service` | 0 | 44 通过，无失败/跳过；[完整输出](service-tests.log) |
| 最后 HTTPS 响应头修改后的 `node --import tsx --test tests/service/api.test.ts`（相同测试库） | 0 | 3 通过；[输出](https-headers-tests.log) |
| `node --test tests/cloud-store.test.js` | 0 | 6 通过，包含授权面板与移交按钮布局回归；[输出](cloud-ui-tests.log) |
| `npm run typecheck:service` / `npm run build` | 0 / 0 | 严格类型通过，单文件重建；[构建输出](build.log) |
| Shell 语法 / Ruby YAML / OpenAPI 引用与路由映射 / `git diff --check` | 0 | Compose 可解析，OpenAPI 41 路径覆盖 50 路由声明、75 引用解析；不等同于 Compose 原生运行或规范认证 |

服务测试包括：数据库升级/回滚/校验和、角色与吊销竞争、原子审计/CAS/收据、静态路径/MIME/穿越/后台守卫、维护/大小策略、CSRF 安全重试、SDK Bridge 工具权限、真实 `pg_dump`/`pg_restore`、资产损坏检测和失败审计、跨进程备份锁、受限生产角色 public schema 恢复、实际 Node 进程 SIGTERM 重启后会话/正文/修订/收据保留。

曾发现并修复：`/app` 相对资源地址与根目录尾斜线导致 404；移交按钮被集成编辑器布局隐藏；public schema 已存在使生产形态恢复失败；恢复检查提前记录成功；启动时错误标记另一个活跃备份任务中断。受限端口导致的首次旧版测试失败已在允许回环监听后完整重跑。备份涉及建库/迁移，因此服务套件串行执行，避免测试间 DDL 干扰。

## 真实浏览器与 MCP

Playwright CLI 驱动已安装 Microsoft Edge，任务专用独立 profile `/private/tmp/sp-alpha-edge-profile`，服务 `http://127.0.0.1:3027`。只用合成测试用户和独立 schema。

- 浏览器登录后新建项目；原生编辑器修改标题并显示“已保存到云端 · 修订 1”；回主页和刷新后读回。
- 实际展开 Agent 设置读到授权元数据；“保存并交给 AI”按钮可见并释放写权，父/子编辑状态均为只读。
- 实际 SDK Bridge 修改该项目标题并插入文字；浏览器点击“取回编辑”，回读标题 `AI接力保存与浏览器回读`、修订 2 和新文字；[Bridge 输出](browser-bridge.log)。不是两个模拟权威库。
- 另一独立浏览器 context 登录 User B，读取 User A 的 ID 返回 404；后台返回 403 并显示访问受限。
- 实际断网输入后显示“云端未确认保存”，切回本地保留恢复草稿；联网恢复为独立云端项目。回读原项目标题仍为 AI 接力版本，原文稿未覆盖。
- 独立管理员 context 实际进入 `/admin`，显示数据库统计与账号/项目/授权概览。
- 任务 Edge 实例完整关闭后，同一 profile 重新启动（新 PID 60843），原账号会话恢复、原项目修订 2 和 MCP 文字读回。只操作任务实例，没有关闭用户原有浏览器。

[实际云工作台截图](workspace-edge.png)。编辑器会话的真实文字/形状、拖动/缩放/旋转、图片重开、HTML 导出/重导入见 [编辑器证据](../../acceptance/sp016-editor-p1-followup.md)。该记录不宣称完整跨浏览器发布验收。

## 生产事实与剩余门槛

Workbench 只读核实 Hakari：`i-7xv7se8pshu9lm5q5j5n`，广州，公网 `8.138.195.143`，x86_64。2026-10-11 快照 RAM 1735 MiB、可用 459 MiB；磁盘可用约 22 GiB；Docker 未安装。80 为现有 Nginx/Paperclip，5432 为现有本机 PostgreSQL，必须保留；443 当前空闲。

Cloudflare DoH 查询 `sp.jxcz.top` A 记录返回 `Status:3`（NXDOMAIN），未发布 DNS/证书。无任何远程部署、重启既有服务、生产 DB 修改或付费资源创建。

部署包只占用 443，不公开应用/数据库端口。迁移账号负责 DDL，应用账号仅 DML，恢复身份非超级用户且仅有 CREATEDB。生产 URL/秘密不在文稿、日志或仓库内。公开上线前须复核容量、安装运行 Docker、配置 DNS/入站 443/HTTPS、初始化真实管理员、确认容器重启与资源压力、配置每日与离机加密备份并进行恢复演练，再跑正式 CI 与发布验收。

部署具体步骤见 [Hakari 包](../../deployment/hakari.md)。当前没有正式 GitHub CI/远端合并/Release 或公网可用证据，因此不能标记 Alpha 发布完成。

浏览器重开后的列表进一步核实：原 AI 项目与 `断网草稿保留验收 · 云端恢复副本` 两条记录均在，恢复副本数量 1。验收结束已关闭任务专用 Edge、临时服务和本任务独立 PostgreSQL 集群；临时身份状态文件已移除，仓库无测试 PAT。用户原有浏览器与业务服务保持运行。

共享项目记忆 retain 已被接受为异步任务，但即时 recall 仍为空，本次不能宣称共享记忆已持久化；事实以本页代码与验收证据为准。
