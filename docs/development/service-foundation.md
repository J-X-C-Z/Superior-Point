# 服务化基础开发：本地运行与验收

本阶段为 Roadmap v1.0 第1批 SP-001～006，加 SP-007 首个管理员初始化和账号创建。仅提供统一服务 API；现有 Web 编辑器仍使用 IndexedDB，旧 stdio MCP 仍使用文件库。CloudProjectStore、PAT/Bridge、后台 UI 与 Hakari 部署按后续批次推进。

## 环境与启动

Node.js 22+、PostgreSQL 17+（本机本次验收使用隔离 PostgreSQL 18.1）。只为SP建立专用数据库和用户，不复用其他业务库。生产不得采用测试用 trust 认证。

```sh
npm ci
export DATABASE_URL='postgresql://sp_app:YOUR_PASSWORD@127.0.0.1:5432/superior_point'
npm run service:migrate
export SP_BOOTSTRAP_USERNAME='your-admin-name'
python3 -c 'import getpass; print(getpass.getpass("First administrator password: "))' | npm run service:bootstrap
export SP_DEV_HTTP=1
export SP_ORIGIN='http://127.0.0.1:3000'
npm run service:start
```

启动器只监听本机回环3000端口。HTTP需显式设置 `SP_DEV_HTTP=1`，仅接受回环 Origin。默认使用生产 HTTPS Origin `https://sp.jxcz.top` 和 Secure Cookie；在真正部署反向代理之前不宣称HTTPS可访问。

管理员初始化仅CLI接收标准输入密码，不接受URL或命令行口令。密码最少12字符，用户名3～64个字母/数字/下划线/点/短横线。初始化仅全空账号库成功；并发初始化只有一个成功。CLI不会自动迁移数据库，也不创建默认弱密码账户。

## 接口调用

契约见 `docs/api/openapi.yaml`、错误码见 `docs/api/errors.md`。登录返回用户与CSRF Token，会话保存在HttpOnly Cookie；开发Cookie名 `sp-session`，生产 `__Host-sp-session`。浏览器/脚本须保持Cookie。

所有POST/PATCH/DELETE需精确 `Origin`；登录以外的写请求还需 `X-CSRF-Token`。服务端从会话建立身份，拒绝伪造owner/role字段。登录默认每来源IP15分钟10次尝试；服务重启后计数清空，本阶段不接入分布式限流。

项目创建和读写只作用于当前owner，管理员也不能读取其他人的文稿。PATCH文档带 `expectedRevision`、唯一 `clientMutationId`、Core的 `operations`，例如 `updateElement` 用 `properties`。相同变更重试返回首次持久化结果；同ID不同内容失败；409冲突不应盲写重试。请求体和文档正文各限32MiB。

全量 `replaceContent` 快照必须先取得60秒租约并提供 `leaseToken`；活动租约期间所有其他写请求也要有效token，不能主动抢占。租约续期、释放接口见OpenAPI。服务端锁定活动用户及会话，使禁用、吊销与文档提交有确定顺序。尚无用户端“交给AI”移交UI。

## 数据和迁移

迁移文件使用明确SQL编号和SHA256记录；加PostgreSQL事务锁，任一步失败全部回滚，已应用文件被改变则拒绝。文档保存、历史快照、幂等收据与审计同一事务；失败不留下半提交。额外原生编辑器字段沿用Core保留。

`001_foundation.down.sql` 只供隔离验收；`rollbackTestSchema()` 强制仅接受 `sp_test_*` 测试schema。对生产库回滚、删除或更改已有SQL，需要单独评估备份与数据迁移方案。本轮没有接入或修改现有服务数据库。

## 测试

创建**独立回环测试库**，库名必须为 `sp_foundation_test`；测试自动创建随机schema并结束清理，不读取业务数据。

```sh
export TEST_DATABASE_URL='postgresql://sp_test:TEST_PASSWORD@127.0.0.1:5432/sp_foundation_test'
npm run typecheck:service
npm run test:service
npm test
npm run build
```

缺少测试数据库时服务测试直接失败，不能把跳过数据库算作验收。服务测试包括真实PostgreSQL、HTTP请求及API进程退出重启；Fastify inject请求检查不等于实际浏览器验收。测试账号/口令仅存在于隔离测试fixture，不是生产种子。

CI配置 `.github/workflows/service-foundation.yml` 使用Node22和PostgreSQL17执行同一检查；此轮只完成本地执行，远端CI结果待推送后核实。

## 后续批次

SP-008/009：云端项目存储和保留原数据的迁移向导。SP-010/011/012：PAT、同库MCP Bridge、人机接力和草稿恢复。SP-029～037：独立管理后台。SP-013～016：核实Hakari、部署、HTTPS、备份恢复与完整发布验收。当前框架发布版本仍为v0.0.1，不发布Alpha标签。

既有基础渲染器隐藏元素字段存在兼容问题（`visible:false` 与 `hidden` 不一致，旧分支只读复现）；不属于本次服务写入改动，后续导出验收须处理。
