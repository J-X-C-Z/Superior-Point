# PowerPoint 常用效果对齐 · 第二批

状态：完成。依赖：12、13、14 已完成。

依据用户要求继续扩充，参考 Microsoft 官方效果表，以名称和主要视觉行为对齐。优先补出现/消失、劈裂、伸展、弹跳、回旋、放大并旋转、跷跷板，以及页面覆盖/揭开、劈裂、圆形和菱形。保持编辑预览、时间轴和 HTML 放映共享实现，旧 ID 与旧数据保留。不将网页实现等同于 PowerPoint 全量兼容或 PPTX 无损动画往返。

验收：有效果差异的真实帧/CSS；保存重开和导出保留；减少动态效果降级；代表性真实浏览器播放；针对性回归。

交付：切换 15→27（新增覆盖/揭开四向、劈裂 H/V、圆形、菱形）；对象动画 29→46（新增进入 8、退出 8、强调 1，共进入20/强调7/退出19）。共有帧与时间轴支持瞬时 steps、双轴缩放、Y轴回旋；修复回旋后跷跷板/旋转错误继承 Y 轴。新圆形/劈裂默认旧页保持完整，无背景缺口；明确的退出效果保留，导出白名单保留 data-sp-transition-exit。

测试：30 项定向回归通过；最后补充的导出显式退出标记断言所在 3 个整合用例单独重跑通过。包括旧效果保留、新增几何、默认与显式退出、前进倒退/减少动态/销毁恢复、延迟与重入、编辑器映射及两种 HTML 导出。此次未重复全仓库回归。

浏览器：首屏出现延迟0.7s内 opacity0，之后1；覆盖新页变换约228px，旧页不移动且opacity1；揭开旧页变换-550px/z12，新页静止/z11；倒退覆盖约-228px；圆形中间半径58.4%，旧页sp-hold-out完整。编辑器27项选项可见，新弹跳添加并整页预览，保存到修订2。代表性浏览器验收，其余方向由模拟测试覆盖。保留用户编辑页面，刷新后加载新版。

示例 examples/powerpoint-effects-example.html 与聊天outputs的HTML/JSON。仍未承诺像素级PowerPoint复刻或全量PPTX动画兼容；录制、引擎失败fallback、file://与完整浏览器重启未验证。

来源：
- https://support.microsoft.com/en-au/powerpoint/animation-effects-available-in-powerpoint-for-the-web
- https://learn.microsoft.com/en-us/office/vba/api/powerpoint.msoanimeffect
- https://learn.microsoft.com/en-us/office/vba/api/powerpoint.ppentryeffect
