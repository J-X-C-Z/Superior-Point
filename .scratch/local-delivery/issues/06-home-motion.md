# 06 首页鼠标点阵

状态：完成。用户要求参考 https://mimo.mi.com 增加一点鼠标动画。

实现：108 个橄榄绿半色调点，鼠标近场排斥、弹簧归位；装饰绝对定位，不移动文字与新建按钮。仅动态 transform，无新依赖。减少动态/粗指针静态；进入编辑器、后台立即停止；归位后无空转。窄屏保留淡色装饰。

验证：npm run build 退出0；node --test tests/home-motion.test.js tests/standalone.test.js 3/3通过。真实浏览器855px宽确认点阵显示与变换、新建弹窗打开/取消正常。未完成真实触屏验收。
