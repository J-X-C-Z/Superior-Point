# v1.1 服务能力本地验收

分支：roadmap/v1.1-services，基于 24ea406；本批尚未部署 Hakari。

- 原生 Streamable HTTP MCP：官方 SDK 真实 HTTP + PostgreSQL，同一套 16 个工具，权限、CAS、撤销和业务数据共用现有服务。无状态 JSON；SSE 通知尚未实现。
- OAuth：授权码 + PKCE S256，独立授权界面，发现元数据、同意、项目白名单、撤销。真实 buildApp + SDK 联合测试通过；外部 REST 保持 PAT-only，OAuth 仅经 MCP 私有转发。第三方桌面客户端和真实浏览器交互尚未验收。
- 统计：后台管理员导航已接入，记录已验证用户、工具、耗时、结果，不保存参数或文档。真实工具调用和统计表失效测试证明业务创建/编辑仍各提交一次。stdio 完整工具耗时尚未接入。
- 资源：应用进程、可见 cgroup、应用文件系统和数据库实际探测；Hakari 整机采集器尚未部署，缺少采集文件时明确不可用。

验证：类型检查通过，JavaScript 261 项：260 通过、1 项既有环境跳过；服务 66 项中 64 通过，2 项因遗漏本机 pg_dump/pg_restore 路径失败，补齐路径后原备份服务和部署角色测试均通过；更新后的 SDK MCP 统计集成重跑通过。测试使用独立回环 PostgreSQL，没有开启生产备份。

证据：/private/tmp/sp-v11-m3-js.log、sp-v11-m3-service.log、sp-v11-m3-service-recheck.log、sp-v11-m3-backup-recheck.log、sp-oauth-integrated-tests.log、sp-v11-observability-integration.log。日志保留实际执行结果，不能代表公网发布验收。

编辑器由原会话独立维护；用户要求暂不向该会话布置任务。本分支不包含之后编辑器新增改动。生产备份继续按用户决定延期。

审阅修复：工具响应不等待遥测，统计并发上限 2、锁等待 100ms、SQL 250ms；排他锁期间业务仍提交，指标会丢弃而不阻塞，解锁恢复。新增阻塞 Promise 回归 1/1 与实际数据库锁集成 4/4 通过，证据 /private/tmp/sp-v11-telemetry-bounded.log。统计总数仅表示已记录事件。
