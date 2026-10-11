# 保留静止留白，只倾斜页面

状态：完成；纠正17的理解。

恢复142px封面高度（窄屏原110px）、16px内边距和原留白背景。封面作为尺寸容器，SVG宽度取可用宽度与可用高度×页面比例的较小值，高度由自身页面比例确定；整个SVG盒就是页面，内部没有letterbox。移除项目卡片整体上移，3D仅施加SVG，外框/留白/打开编辑提示均不继承3D。

验证：构建成功，motion+standalone4项通过。真实IAB7个封面容器222×142、内边距16px；SVG190×106.875精确16:9，左右留白16px。真实指针移动观察SVG perspective/rotateX/rotateY，卡片与cover computed transform均none，提示无inline transform；浏览器截图确认固定留白。未修改用户文稿。
