# Alpha 候选服务运维

本文对应当前工作树中的服务实现，不表示已部署到生产。Node.js 22+ 与 PostgreSQL 17+ 是运行要求；数据库应使用独立数据库和受限应用账号。

## 初始化与启动

后台「用户」页支持删除账号。确认后账号从用户列表移除，所有会话和 Agent 授权撤销，不能重新启用；用户名仍保留，不能重新注册。文稿、修订和审计记录保留，可通过既有项目管理流程转移归属。删除要求最近的管理员密码验证，最后一位有效管理员不可删除。此操作不执行文稿或审计记录的物理清除。

```sh
npm ci
export DATABASE_URL='postgresql://sp_migrator:YOUR_PASSWORD@127.0.0.1:5432/superior_point'
npm run service:migrate
export DATABASE_URL='postgresql://sp_app:YOUR_PASSWORD@127.0.0.1:5432/superior_point'
export SP_BOOTSTRAP_USERNAME='admin-name'
python3 -c 'import getpass; print(getpass.getpass("Administrator password: "))' | npm run service:bootstrap
npm run service:start
```

初始化密码只通过标准输入提供，至少 12 个字符；初始化仅允许空账号库。迁移不会由管理员初始化命令隐式执行。启动监听地址、Origin、Cookie 与环境配置应以 `server/start.ts` 和 `docs/development/service-foundation.md` 为准；本机 HTTP 开发需显式配置 `SP_DEV_HTTP=1`，不得将其用于生产。生产应由 HTTPS 反向代理提供外部入口。

## 验证

测试使用独立 PostgreSQL 测试库，严禁将业务库用于测试。示例库名必须保持 `sp_foundation_test`：

```sh
export TEST_DATABASE_URL='postgresql://sp_test:TEST_PASSWORD@127.0.0.1:5432/sp_foundation_test'
export SP_TEST_PG_BIN='/absolute/path/to/official/postgresql/bin'
npm run typecheck:service
npm run test:service
npm test
npm run build
```

`test:service` 是串行执行服务端 TypeScript 测试；`SP_TEST_PG_BIN` 必须指向包含真实 `pg_dump` 和 `pg_restore` 的 PostgreSQL 客户端工具目录，以执行备份与恢复验收。没有测试数据库或这些工具时相关服务测试应失败，不能把跳过视为通过。测试须使用隔离 schema 并清理自身数据。

## MCP Bridge

Bridge 通过 stdio 启动，配置 `SP_API_URL`、`SP_API_TOKEN`，可用 `SP_BRIDGE_ROOT` 限定文件导入/导出范围：

```sh
SP_API_URL='https://sp.example.invalid' SP_API_TOKEN='YOUR_TOKEN' npm run mcp:bridge
```

Bridge 连接远端服务时要求 HTTPS。仅本机回环调试可显式设 `SP_BRIDGE_ALLOW_HTTP=1` 并使用 loopback 地址。令牌应最小授权、妥善保管并在不用时撤销；不要把真实凭据放进命令历史、文档或日志。

## 上线验收边界

当前文档和本地测试不能证明生产部署成功。生产 DNS、容器镜像构建与部署、HTTPS 入口、离机备份、恢复演练、监控告警及真实用户验收仍需逐项完成并留存证据。备份 API 的可用性依赖部署时配置的备份服务；列表或恢复检查响应不等于离机备份已恢复成功。
