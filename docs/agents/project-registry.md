# Superior Point 项目统筹台账

当前阶段：v0.1 Alpha 全部P0，按服务路线图v1.0推进。服务基线f1cc67a；当前服务分支service-foundation。统筹会话01a12950-79f6-7091-a216-019faa566e40负责统一契约、服务数据库、整合验收和部署。

编辑器领域负责人：会话“编辑器开发”01a128c3-f716-71c0-86ce-f8a111e36774，原editorcheckout供commit整合，负责编辑器、IO、导出兼容与SP016遗留验收。不创建新的持久会话。

临时子任务：CloudProjectStore/迁移/接力；PAT与权限；MCPBridge；后续Admin和部署。共享契约docs/architecture/alpha-contract.md。长期状态按Milestone汇总，不用第二调度器。v0.2及主题/PPTX新能力不作为当前AlphaP0自行扩展。

当前交付：Alpha候选实现7d1f765；本地193通过/1原有跳过，服务44通过；真实Edge登录、云端保存/刷新、SDK MCP接力、账号隔离、断网独立恢复、后台概览与任务浏览器完整退出重开通过。备份真实受限账号public恢复与跨进程互斥已通过。详见docs/verification/alpha/acceptance.md。

待发布验收：Hakari Docker实际构建/运行、DNS/HTTPS、每日及离机备份、正式CI/远端合并/发布；编辑器Chrome/Firefox与剩余兼容矩阵。生产凭据未建立，没有远程写入，不能宣称Alpha已上线。
