# 头像账号入口验收 — 2026-10-11

按用户截图反馈，将默认全宽登录区改为工作台右上角的小头像按钮；点击后展开紧凑的二级登录/账号面板。编辑器内不显示头像、用户名或登录表单。设计参考成熟产品的[右上角头像账号入口](https://support.google.com/mail/answer/35529?hl=en)，保留现有工作台配色与字体。

仅更改父工作台账号布局与可达性；认证 API、后端权限、编辑器 vendor/adapters 不变。本地/云端切换、迁移、Agent 授权和恢复沿用原操作。AI 接力按钮置于独立紧凑动作条；只在异常状态提供草稿恢复和保留草稿返回入口。

`node --test tests/cloud-store.test.js tests/standalone.test.js` 退出 0，7/7 通过；包括点击入口、Escape/外部关闭/密码清空、原生弹窗 Escape 不被账号层拦截、登录后收起、编辑器隐藏账号、接力/取回、离线草稿保留退出和恢复。退出会拒绝丢弃未确认的 raw editor snapshot，测试验证原会话及草稿仍保留。`npm run build` 退出 0。输出见[focused-tests.log](focused-tests.log)。

实际 Chrome 151 独立 profile `/private/tmp/sp-account-menu-profile-20261011`，Playwright CLI，预览 `http://127.0.0.1:8770/web/`：默认只有[头像](home.png)，点击后[登录面板](login-menu.png)宽 344、高约 323 像素；用户名自动聚焦，Escape 收起并返回头像焦点。实际通过 UI 新建文稿，[编辑器](editor.png)加载完成且头像/登录表单不可见。390×844 [手机尺寸](mobile-login.png)面板 x26、宽344，处于视口内。没有关闭用户原有浏览器。

已在既有部署实测：头像面板登录成功后收起，编辑器不显示登录模块；断网改动可通过可见入口保留草稿并返回工作台，原云端项目未被覆盖。生产截图和完整浏览器记录仅保留在本机，不随源码推送。正式 CI 38130565307 已通过。本地预览没有服务端 API，不能把模拟 DOM 或本地截图当作生产认证证明。
