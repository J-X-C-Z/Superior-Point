# 19 服务化基础开发（Roadmap v1.0 第1批）

状态：本地实现与验证通过；远端CI/合并、Web云存储、PAT/MCP Bridge、后台与Hakari发布未验收。

用户授权：2026-10-11 按开发路线图v1.0进行基础开发并交给子agent并行；复杂6.1Sol/medium、简单6Luna/high。准确路线图由用户提供Downloads/Superior_Point_服务化开发路线图_v1.0.md，原件只读，仓库保留引用副本。

验收边界：SP-001～006及SP-007bootstrap/创建账号。基线a10a4e3；隔离开发副本保留之前编辑器精修，没有覆盖原checkout或用户文稿。

实现：TypeScript/Fastify/PostgreSQL、Argon2id、哈希会话与CSRF、Origin防护、登录限流、owner隔离、管理员API、最后管理员保护、唯一ProjectService、CAS/收据/租约/修订/审计原子事务。额外独立复核发现并修复业务事务内会话撤销空隙，以及会话互相吊销的锁循环。

证据：22项服务测试全部通过，实际PG与API进程重启/CLI初始化；旧版159通过、1原有跳过；类型检查/build/diff检查通过。参见docs/verification/service-foundation/acceptance.md和原始log。

下批依赖：SP-008/009、SP-010/011/012，之后后台与部署。不同存储尚未接通，不标为Alpha或完整服务化完成。
