# Hakari Alpha 部署与验收 — 2026-10-11

生产服务已部署，公网 HTTPS、浏览器云端保存、SDK MCP 同库接力、权限隔离和 app/db 容器重启验收通过。此次按用户“先不备份”延期生产备份；整机重启未演练。此记录不把延期项写成通过，也不宣称完整 v1.0 路线图或 Stable 已完成。

## 交付身份

- 仓库：J-X-C-Z/Superior-Point；部署目标 Hakari `i-7xv7se8pshu9lm5q5j5n`，广州，Linux x86_64。
- 地址：<https://sp.jxcz.top/app>；独立后台：<https://sp.jxcz.top/admin>。
- 已实测运行逻辑来源 `4cb41eab9f8cec444527c9957aae92df9c75a705`。Alpha 版本元数据提交 `61c9438d460e57be874180aebedb07da967a6a5a` 仅调整包版本、页面标记和发布构建；API、编辑器及数据库逻辑保持一致。正式版本原生构建与切换结果见后续追加记录。
- 首个管理员通过服务器 stdin-only bootstrap 创建；无公开初始化接口或默认密码。凭据在本地和服务端受保护文件中，未进入仓库、发布包或此证据。
- 每个发布版本位于 `/opt/superior-point/releases/<commit>`；数据、图片及证书状态在 `/opt/superior-point/shared/data`。独立 PostgreSQL 初始化、DDL、应用 DML 和隔离恢复身份。

## 实际生产证据

命令工作目录均为本任务 `Superior-Point` checkout。远程命令只通过 Workbench 操作明确实例；远程执行目录为 `/opt/superior-point/releases/4cb41ea`。下表保留原始结果，内部 HTTP 与公网 HTTPS 分开。

| 检查 | 命令 / 退出码 | 实际结论 |
|---|---|---|
| 公网 HTTPS API | `node work/deployment/accept-public.mjs`，0 | 管理员登录/近期密码/CSRF；创建两名合成普通用户；Core/CAS；跨用户读取/导出/后台拒绝；管理员私人正文拒绝；PAT 权限、租约、修订回读、吊销、审计全部通过。[原始输出](public-acceptance.log) |
| 真实本地 Agent 协议 | `node work/deployment/public-mcp-proof.mjs`，0 | SDK Client/StdioClientTransport → 本地 Bridge → **公网 HTTPS** → 生产 PostgreSQL；读改验导出、allowlist 外项目拒绝、缺 Scope 拒绝、撤销后 401；临时 PAT 已吊销，客户端已关闭。[输出](public-mcp-proof.log) |
| 浏览器 → AI → 浏览器 | `node work/deployment/public-handoff-proof.mjs`，0；真实 Chrome UI 命令均 0 | 浏览器保存正文至 r3，点击“保存并交给 AI”确认只读和释放租约；SDK CAS 改同一项目到 r4，原 slides 完全保留；浏览器重新打开读回新标题、正文和 r4。[MCP 输出](public-handoff-proof.log)、[DOM 回读](handoff-readback.txt)、[截图](public-handoff-readback.png) |
| 生产后台 | 真实 Chrome Playwright CLI，0 | 概览、用户、项目、Agent 授权、审计、系统设置、备份状态页全部实际加载。只读取备份页，没有执行备份或恢复。[截图](public-admin.png) |
| Chrome 完整退出重开 | Chrome 151.0.7922.34，独立持久 profile | 主进程 `35168` → 匹配进程确实消失 → 新主进程 `41891`，同 profile；账号会话、已存标题和文字恢复。[进程证明](browser-exit-proof.json)、[主页回读](reopened-home.txt) |
| app/db 实际重启 | `python3 work/deployment/remote.py work/deployment/restart-owned-containers.sh`，0 | app/db 分别实际重启并健康；权威文稿 revision、canonical JSON 指纹完全一致。未以浏览器刷新代替容器重启。[原始输出](container-restart.log) |
| 原生 Linux 构建 | Docker Linux 构建，0 | Node 22.23.3，linux/x64、Node ELF 及 Argon2id hash/verify 实测通过；没有复制 macOS 原生依赖。[原始证明](native-probe.log) |

合成验收账号和文稿有 `spaccept-*` 或 `Hakari ... 验收` 标记，保留供复核；全部临时验收 PAT 已撤销。没有删除真实用户数据。

## DNS、证书与现有服务

复用用户已有 Cloudflare zone，只新增 `sp.jxcz.top A 8.138.195.143`（DNS-only，TTL auto）。现有 16 条 DNS 记录保持，新增后 17 条；权威 DoH A 回读成功，无新增 AAAA。安全组仅新增 TCP 443，原 ICMP/SSH/RDP 规则保持，应用 3000 与新数据库 5432 不向宿主发布。

Caddy TLS-ALPN 取得可信 Let's Encrypt YE1 证书：域名 `sp.jxcz.top`，有效期 2026-10-11 至 2027-01-09。实际浏览器和 Node HTTPS 默认执行证书校验，没有绕过浏览器安全警告或关闭 TLS 校验。早期网络超时后自动签发成功，未安装拟议的额外代理转发服务。macOS 系统 curl/LibreSSL 路径发生连接重置；独立 Chrome、IAB 与 Node HTTPS 成功，因此不将该 curl 路径误计为通过。

现有 Nginx `25721`、host PostgreSQL `153229`、Hindsight API `7525`、Hindsight UI `137426`、HBR client `2016`、Mihomo `37005` 主 PID 保持，NRestarts 全为 0。Hindsight health 200、UI 307；Paperclip 502 在部署前就存在，本轮未改它的配置。[实际状态与证书](final-runtime.log)

该状态快照中 SP app/db/Caddy 约 65/30/32 MiB，无 OOM 或重启循环，Docker enabled，容器 `unless-stopped`。主机约 668 MiB 可用，已有 swap 使用和短时 memory PSI；这是受限主机的轻载运行证据，不宣称高并发容量验收。

## CI 与编辑器证据

Node 22 的正式 GitHub Actions `38125197721`、文档提交检查 `38126249464` 已通过：服务 PostgreSQL 集成 48 项全通过，本地套件 193 通过、1 原有有意跳过，严格类型和构建通过。版本元数据提交的最新 CI 另行读回后记录。

Chrome/Firefox 原候选的文字/形状、真实指针移动/缩放/旋转、本地图片、保存重开、实际 HTML 下载与重导入及完全退出重开，见[冻结编辑器证据](../../acceptance/sp016-frozen-browser-mainpaths.md)。Edge 云保存、离线恢复和完整进程重启见[本地 Alpha 证据](../alpha/acceptance.md)。这些环境与生产验收各自独立；不把 DOM 模拟当成实机，也不声称新的 PPTX 或复杂动画兼容。

## 已授权延期与产品限制

用户明确“先不备份”：未运行生产备份，未新增定时任务，未配置离机存储，未演练生产数据库/图片恢复。已有 HBR 代理 running，但广州区域备份库/计划查询为 0，不能当作已有备份。仅本地与 CI 的受限身份隔离恢复测试通过。

未重启整台 Hakari，以遵守不影响现有服务要求；Docker 开机启用和容器重启策略已核实，整机启动恢复仍待维护窗口实测。备份与整机恢复因此保持“延期/未验收”，不满足路线图中这两项的完整验收条件。

远程 HTTP MCP/OAuth、多人实时共编、素材库、复杂 PPTX 新能力属于后续阶段。高级动画/录制/剪贴板权限和离线播放只按编辑器实际兼容证据声明。此轮交付是带上述边界的 Alpha 预发布。

## 发布检查收口

CI `38127554194` 在测试临时库清理发生真实竞态而失败（47/48）：`pg-pool.end()` 可先于客户端 socket 关闭返回，随后强制删库导致未处理连接异常。本轮仅修测试等待全部 `remove` 事件后普通删库，未修改产品备份实现。注入 100ms 关闭延迟可确定性复现[旧代码失败](ci-race-before.log)，同样注入[修复后通过](ci-race-after.log)，独立 PG18.6 全套[48/48 通过](ci-race-service-suite.log)。正常本地套件 193 通过、1 原有跳过；首次沙盒端口 EPERM 已在允许回环监听后完整重跑通过，未把受限失败当成通过。

Alpha 原生镜像 `superior-point-app:61c9438` 已构建成功，Docker image ID `sha256:681e1721fced48859d00d799e1c971eb6d1c2b6b39cb2dd96829d4dbba2e959c`，Linux/amd64，实际包版本 `0.1.0-alpha`、Node22 ELF、Argon2id 验证通过。[实际新镜像证明](native-alpha-probe.log)。正式切换与 CI 结果另行追加。

编辑器会话补齐了[冻结候选离线放映与权限/PPTX 子集验收](../../acceptance/sp016-frozen-presentation-permissions-pptx.md)：真实窗口放映、基础淡入/淡出及内嵌 Reveal 离线 HTML、图片/表格/图表呈现通过；PPTX 仅为导出 ZIP/XML 结构子集，无 PowerPoint 渲染保真承诺。集成全屏/媒体录制权限未通过，工作台不接受 PPTX 导入，同对象脉冲/完整动画目录未取得通过证据。Alpha 只按这一实测范围发布，不承诺上述缺口已修复。


## 正式 Alpha 运行版本

运行版本已切换为 `61c9438d460e57be874180aebedb07da967a6a5a`（`0.1.0-alpha`），image ID `sha256:681e1721fced48859d00d799e1c971eb6d1c2b6b39cb2dd96829d4dbba2e959c`，稳定运维路径 `/opt/superior-point/current`。只重建 app；db/Caddy 未重建，全部 5 份文稿 revision/JSON 指纹相同，现有六项业务服务 PID 不变。[实际切换记录](alpha-cutover.log)

切换后公网 HTTPS 管理员 readiness 200、原接力文稿 r4 及完整正文回读、页面版本标记均通过，验收脚本退出 0；先前脚本错误期待版本前缀 `v` 已修正，不属于产品缺陷。[公网复核](public-alpha-smoke.log)、[最终运行截图](public-alpha-final.png)。日常 app 的隔离恢复 URL 已置空，生产备份仍未运行。

真实 Caddy 管线的登录限流：外部 Node 请求每次伪造不同左端 X-Forwarded-For，10 次 401 后第 11 次仍为 429，不能用伪造地址绕过。第二个真实来源（容器经 Caddy HTTPS，默认验证证书）仍为 401，确认限流不是共享 Caddy IP；测试后只重启 app 清除合成限流计数，保证正常登录可用。[公网限流](public-proxy-proof.log)、[第二来源与清理](caddy-second-client-proof.log)。测试客户端最初错误处理 Node DNS all 回调，已修正后实测通过，无产品配置变更。

修复后的正式 GitHub CI `38128071818` 通过，Node22/真实 PG18：48 服务测试全通过，193 常规测试通过、1 有意跳过，类型检查与构建通过。[完整原始 CI 输出](ci-38128071818.log)。最终源码相对镜像构建提交，仅增加文档、测试清理修复和发布 ZIP 权限修正；`git diff 61c9438 HEAD -- server mcp core storage web adapters io vendor package.json package-lock.json deploy/hakari/Dockerfile` 为空，运行输入一致。

发布包保留部署脚本可执行权限，排除 credentials、工作数据、数据库和浏览器临时产物。部署/回滚只使用固定 Compose project，应用回退明确 `--no-deps`；旧镜像及 shared state 保留，生产数据库回退仍无验收承诺。
