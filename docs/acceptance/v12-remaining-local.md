# 主题库 v1.2 · 本地剩余验收补充

日期：2026-10-12。记录本轮新增的 Codex 内置 Chromium 窄屏、个人主题归档/恢复、正式 UI JSON 往返、可选布局/组件预设和损坏图片拒绝证据。此报告不代表完整 Beta 验收或生产部署。

## 环境与结果

| 验收项 | 实际观察 | 证据边界 |
|---|---|---|
| 主题库窄屏 | Codex 内置 Chromium 的视口为 390×844；DOM scrollWidth 为 390，没有横向溢出。 | 仅证明此内置 Chromium 会话的该视口。没有记录浏览器版本；不等于独立 Chrome/Firefox 全流程验收。截图：[主题库](../verification/v12-remaining/narrow-library.png)、[主题详情](../verification/v12-remaining/narrow-details.png)。 |
| 个人主题与历史版本 | 正式 UI 复制个人主题并把强调色改为 #185A79；归档再恢复原始 1.0.0 版本。 | 证明该个人主题操作和该固定版本回读路径；不代表完整的版本升级、跨设备或删除恢复矩阵。 |
| JSON 导出与导入往返 | 正式 UI 导出个人主题 JSON，经文件选择器重新导入为新主题，再从 UI 导出。比较结果除新主题 id 和 sourceRef 外，其他字段完全一致。 | 原始导出：[personal-theme-export.json](../verification/v12-remaining/personal-theme-export.json)；导入后导出：[personal-theme-roundtrip.json](../verification/v12-remaining/personal-theme-roundtrip.json)。该项证明此样例的格式往返，不替代恶意包/所有边界值安全验收。 |
| 可选布局和组件预设 | 通过正式 UI 导入缺少 layouts 与 tokens.components 的主题，验证通过并展示五页样例预览。 | 截图：[optional-presets-details.png](../verification/v12-remaining/optional-presets-details.png)。证明此主题样例在未提供可选预设时仍可导入并预览；不证明独立布局/组件插件的安装和应用契约。 |
| 损坏资源拒绝 | 导入含损坏 PNG 的主题文件被 UI 拒绝；主题列表仍为 3 项。新截图显示中文校验提示，说明检查主题 JSON 规范、资源与哈希后重试，并保留现有主题和原始文件。 | 截图：[corrupt-rejected.png](../verification/v12-remaining/corrupt-rejected.png)。仅证明该坏图样例被拒绝和列表计数不变；没有扩大为所有 MIME、哈希或恶意内容场景。 |

## 契约与自动化证据

- Theme Manifest Schema 由支持 JSON Schema Draft 2020-12 的 Ajv 实际加载并执行，27 个契约案例通过；9 个内置主题均通过校验。
- 9 个既有主题的历史 manifest hash 保持不变。
- Manifest 允许省略 layouts 和 tokens.components；验证后的主题按需将它们补成空数组/空对象，Skin 不会因此改动页面几何。缺省预设主题的正式 UI 导入与五页预览见上方截图证据。
- 最新 npm test 共 296 项，295 通过、1 项既有跳过、0 失败；原始日志为 /private/tmp/sp-v12-remaining-final-js.log。
- Skin 预览变更时会使旧预览失效，应用沿用预览对应的 expectedRevision；自动化还覆盖旧请求迟到时不能授权已变化的范围、模式或页面选择。这修复了预览与确认之间 revision 过期的竞争问题；本项由源码及自动化覆盖，不代表真实并发客户端验收。

## 仍未证明

独立 Chrome 正式入口全流程、Firefox（用户明确延期）、跨用户/跨设备主题私有性、完整编辑器/网页放映/HTML 的同稿与 Motion 降级对照仍未完成。离线 HTML、生产备份与回滚演练继续按用户决定延期。该补充不把主题库整体或 Beta 标为完成。

## 千主题真实浏览器容量测量

隔离 PostgreSQL schema 经原生 ThemeService 导入 1,000 个个人云端主题（加 9 个内置主题），从 `http://127.0.0.1:18873/web/` 正式登录入口打开。默认配额未改动，首尾固定快照哈希回读通过。测量使用 CUA 的内置 Chromium 和 Network CDP，服务端只记录 GET 路径、状态、耗时与并发，不记录认证信息。

- 首屏 24 张卡片，共 43 页；从点击主题库到最后一张首屏卡片可见的单次墙钟观察为 428ms。登录后台刷新和主动打开主题库各有一次列表读取、15 个云端详情读取（其余 9 张是内置主题），不是 1,000 个详情读取。
- 翻到第 2 页墙钟观察为 301ms；该页仅 24 个详情请求，网络事件区间为 171.10ms，共 80,376 编码字节，没有额外整库列表请求。
- 临时设置 150ms 延迟、128,000 B/s 下载、64,000 B/s 上传后，第 3 页仍完成 24 个详情读取，网络事件区间 4,521.12ms、80,376 编码字节。自动等待第一次未捕捉到最后卡片，后续 DOM 观察确认完整出现；不把含工具间隔的 24,559ms 当作页面本身耗时。网络设置随后恢复。
- 搜索 `Performance 1000` 只显示第千个主题；无匹配搜索显示空态。页面错误日志为空。浏览器 JSHeapUsedSize 在翻页并过滤后为 14,337,128 字节，属于单次 JS 堆快照，不能代替进程 RSS 或长期泄漏测试。

原始经过认证信息清理的证据：[网络事件](../verification/v12-remaining/performance-network.json)、[服务 GET 记录](../verification/v12-remaining/performance-server.json)、[内存指标](../verification/v12-remaining/performance-metrics.json)、[首屏](../verification/v12-remaining/performance-firstpage.png)、[搜索](../verification/v12-remaining/performance-search.png)。这是本机容量和受限网络场景，不代表 Hakari 公网延迟，也没有 Firefox 或真实触控设备结论。

## 云端路由与慢速预览的真实回归

接口的 `source` 是复制来源元数据，原 UI 将它合并覆盖了自己的 `source: cloud`，导致私人云端主题被误判为内置只读。修复保留 UI 路由/账号，服务来源数据保持原样。真实流程在隔离账号中完成：从主题新建云端文稿、单页预览、明确二次确认后保存修订 1；编辑发布个人主题 1.0.1；固定历史 1.0.0 仍为原强调色 #606760，新版为 #185A79；当前版归档并恢复后仍为 1.0.1。证据：[云端应用](../verification/v12-remaining/cloud-theme-applied.png)、[历史](../verification/v12-remaining/cloud-history.png)、[恢复](../verification/v12-remaining/cloud-restored.png)。

CUA 临时施加 1,200ms 网络延迟，点击整篇预览后立即改成单页；旧请求完成后“确认应用”仍禁用，必须重新预览才启用。[失效预览截图](../verification/v12-remaining/stale-preview-disabled.png)。随后网络设置恢复。

另一个独立 Chrome for Testing 151.0.7922.34（Info.plist 本机读取）会话正式登录同一隔离账号，从 `/app` 恢复会话，能读取相同云端文稿和新发布的 1.0.1 主题。[Chrome 回读](../verification/v12-remaining/chrome-cloud-version.png)。这证明两个独立浏览器客户端回读，不等于两台物理设备验收。`/web/` 是本地优先入口，服务会话恢复应使用正式 `/app` 入口；本次没有以文件离线或下载 HTML 的本机 HTTP 方式验收。

最终源码检查：完整 JS 296 项（295 通过、1 项既有跳过、0 失败），类型检查与构建退出 0；隔离主题服务/MCP 6/6，通过日志为 `/private/tmp/sp-v12-remaining-service.log`。云端 UI 适配器专项 13/13，其中真实服务形状的来源字段回归涵盖详情、编辑、历史应用和归档恢复。

固定文稿独立 API 回读进一步证明：修订 1 仍 pin 1.0.0，旧强调色 #606760 与旧版快照/hash完全匹配；当前主题为1.0.1/#185A79。证据：[pin核对](../verification/v12-remaining/cloud-pin-check.json)。
