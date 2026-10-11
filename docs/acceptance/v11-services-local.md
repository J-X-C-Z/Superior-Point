# v1.1 非编辑器服务验收（本地）

分支 roadmap/v1.1-services，基础 24ea406。以下为冻结前实测，不代表已完成 Hakari 公网验收；线上结果另存部署验收报告。

JavaScript 全量：270 项，269 通过，1 项既有环境跳过，0 失败。真实 PostgreSQL 服务全量：82/82 通过。TypeScript 检查、应用构建、diff 检查通过。生产依赖 npm audit --omit=dev：已知漏洞 0。

已验证：20 个 HTTP/stdio 共用 MCP 工具；OAuth 发现、DCR、PKCE S256、独立同意与权限撤销；SSE 元数据通知不会覆盖浏览器草稿；云端历史差异与幂等恢复；管理员服务器检索/状态筛选；自己的登录会话中心；存储配额；固定修订的只读分享与撤销；范围受限的工具统计和整机/三指定容器指标解析；帮助中心。

正式增强验收脚本 scripts/accept-v11-services.mjs 在 18871 隔离服务实际运行：7 阶段通过，临时 PAT/OAuth/分享撤销、测试账号停用、脚本会话退出，cleanup.failures 空。HTTP 与 stdio SDK 均发现 20 工具并读写同一 PostgreSQL。OAuth 只读指定项目，跨项目/写入被拒绝，外部 REST 不接受 OAuth。SSE 新修订只含元数据，注销会话关闭连接。本机没有整机采集文件，正确返回 unavailable。

工作台大库 DOM 集成：1000 项只取一次元数据，分页最多 24 张卡片，翻页不取正文；重命名和打开重新读取权威全文，保留幻灯片、资源及未知字段。实际浏览器验证：头像二级登录、会话/配额面板、分享两页播放和撤销后不可访问；320/390px 工作台及390/768px主题库无页面横向溢出。此为桌面浏览器视口模拟，不能替代真实触控设备。

证据日志：/private/tmp/sp-v11-final-js3.log、sp-v11-final-service2.log、sp-v11-final-types.log、sp-v11-final-build.log、sp-accept-v11-local.json、sp-library-performance-tests.log、sp-v11-container-metrics.log。截图见 docs/verification/v11/services-local-share.png 和 services-local-sse.png。

限制：个人素材服务及资源 MCP 工具依赖编辑器阶段；完整 Owner/Editor/Viewer 协作 ACL 仅完成评估；stdio 的完整调用耗时未接入统计。Firefox/PPTX完整保真、真实移动设备和大型PPT压力依赖后续编辑器范围。备份和整机恢复继续延期；不宣称 Stable 或全54项完成。
