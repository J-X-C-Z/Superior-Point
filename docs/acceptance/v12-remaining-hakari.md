# 主题库 v1.2 · 非编辑器补充发布验收

日期：2026-10-12。部署源码 `599eb0de3150c74a7380c71758eef3296e0fb716`，草稿 PR [#6](https://github.com/J-X-C-Z/Superior-Point/pull/6)。应用仍为0.1.0-alpha。用户已授权验证后部署；Firefox、离线HTML、备份和实际回滚演练继续延期，编辑器未派任务或修改。

## 已确认结果

- Hakari `i-7xv7se8pshu9lm5q5j5n` / cn-guangzhou：`/opt/superior-point/releases/599eb0d`，镜像 `superior-point-app:599eb0d`，Linux amd64。Node22.23.3为ELF x86-64，Linux esbuild运行探针通过，镜像revision与源码一致。镜像ID `sha256:ce1979d01924d4779ea17e34149e1523c13cb53b0a52abeb7bb6a3051bb8d656`。源码archive SHA256 `23ebafc5175230de9c18a235495ab9c8c7faba659105e481fe033360f831d663`，上传后核对通过。
- [精确提交 CI](https://github.com/J-X-C-Z/Superior-Point/actions/runs/38206599982)成功：服务84/84，JS296项中295通过、1既有跳过、0失败，类型与构建通过。
- 已应用迁移哈希全部匹配；未修改历史迁移。切换前20个既有项目按文稿revision和同revision内容指纹核对，全部保留；没有回滚数据库。旧c90c4ff发布保留。
- 公网验收9阶段全通过：账户、项目/主题历史、固定分享、PAT HTTP/stdio22工具、三语言Skin/CAS/未选页不变、版本/私有资产/诊断、OAuth PKCE受限写入、管理/存储/资源、SSE撤销。隔离测试授权全部关闭，合成账号停用，cleanup.failures为空。
- SP app健康、OOM=false、restarts=0；数据库健康。nginx、postgresql@18-main、hindsight、hindsight-ui、hbrclient、mihomo六个既有服务PID/状态/重启次数与发布前完全一致。
- 正式线上`/app`访问、主题库显示及页面错误日志为空；[线上主题库](../verification/v12-remaining/production-library.png)。本轮真实本机浏览器验收见[补充报告](v12-remaining-local.md)。

原始输出在[发布证据目录](../verification/v12-remaining/)：release-ci.json/log、release-public.json、release-cutover.log、release-image-probe.log、release-before.log、release-final-status.log。临时本机服务18872/18873已结束，性能夹具配置为退出时清理自身隔离schema；未操作生产原有项目或其他应用的临时资源。

## 未关闭的范围

没有把静态SVG/结构检查称为完整渲染或PPTX保真。编辑器与全部渲染器的Motion依赖仍待对应功能验收；本次未纳入编辑器会话未提交候选。两浏览器云端回读不等于两台物理设备。Firefox、下载HTML离线、备份、实际回滚演练按用户延期；AI风格重构和社区T031–032按路线图属于后续P2。因这些范围尚未验收，主题库整体Beta/Stable不记完成。
