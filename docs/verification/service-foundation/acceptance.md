# 服务化基础验收：2026-10-11

## 验收对象

Superior Point服务路线图v1.0第一批SP-001～006，补充SP-007的本地管理员初始化/用户创建API。基线提交 `a10a4e3cb54d55023a40f5ea6ecf4d754b14615c`。实现代码提交 `c9fb9d39537079c93c1f6ea45a8262498ba35ed0`；后续仅整理路线图引用副本格式和补录验收提交。测试对应此提交的实现文件。本次全部新增实现位于隔离副本，原工作目录及用户IndexedDB项目未修改。

工作目录：`/Users/jxcz/.codex/.chatgpt-projects/g-p-6acaf26c67908191983e413a278752ce/Superior-Point`。

运行环境：Node26.8.1，PostgreSQL18.1。测试集群由本任务在 `/private/tmp/sp-foundation-pg` 独立初始化，仅监听127.0.0.1:55439，库名sp_foundation_test，各测试使用随机schema并清理；没有连接Paperclip、Hakari或生产库。

## 实际执行

| 检查 | 执行命令 | 退出码 / 结果 |
|---|---|---|
| TypeScript | `npm run typecheck:service` | 0 |
| 服务集成 | `TEST_DATABASE_URL=postgresql://sp_test@127.0.0.1:55439/sp_foundation_test npm run test:service` | 0，22通过，0失败/跳过 |
| 旧版回归 | `npm test` | 0，159通过，1原有跳过，0失败 |
| 单文件构建 | `npm run build` | 0；生成文件无额外diff |
| 空白检查 | `git diff --check` | 0 |
| API契约 | Ruby YAML解析、内部引用/唯一operationId检查，Python对照实际Fastify路由 | 0，15路径/21操作 |

完整输出保存在 `service-tests.log` 与 `legacy-tests.log`。最初受限环境执行旧版静态服务测试因端口监听权限超时；允许本机端口后完整回归通过。未把初次环境失败计入最终通过证据。

服务集成覆盖：实际数据库初始化/重放/校验和漂移拒绝/回滚重建、Argon2id哈希和会话秘密仅哈希存储、未知/错误/禁用账号统一登录失败、Cookie/Origin/CSRF/限流、跨用户和管理员正文拒绝、CAS竞争、重复收据与不同内容ID重用、租约/快照/到期、审计故障整体回滚、被撤销/过期会话的旧Actor拒绝、会话撤销与写入锁竞争、管理员互相吊销避免死锁、最后管理员并发保护、CLI标准输入初始化及重复拒绝。

`process.test.ts` 实际开启HTTP进程，登录、创建、编辑文档，SIGTERM退出后启动全新进程，使用原会话读取同一PostgreSQL文档，断言revision/正文不变。这是API进程重启；没有把它称为浏览器或数据库进程重启验收。

## 完成边界

本地服务基础代码和上述测试通过；SP-001的OpenAPI采用YAML结构、内部引用和路由映射检查，未冒称完整OpenAPI规范认证。CI工作流已配置Node22/PostgreSQL17，未在GitHub执行；远端合并和发布仍未完成。

本阶段未接通现有Web与MCP云端同库链路，未实现PAT、CloudProjectStore、迁移向导、完整Admin UI/二次认证、素材服务、Hakari HTTPS/备份恢复。它们属于路线图后续批次。本次无真实浏览器验收或生产变更，不宣称v0.1Alpha发布完成。
