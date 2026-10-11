# 接入用户编辑器：边界与约定

正式入口 `web/entry.js` 已注册用户交接的 v0.39 编辑器集成适配器；`web/editor-adapter.js` 的备用默认实现仍是只读基础预览。原件不变，父 Core 保持事务、修订和保存权威。具体实现与限制见 `editor-candidate-bridge.md`，来源见 `EDITOR_HANDOFF.md`。

## 最小接入 API

`registerEditorAdapter({ id, mount(context) })` 注册一次；在打开项目之前注册。`mount` 可异步，返回 `{ update(document), setReadOnly(boolean), destroy() }`。

context 字段：
- `container`：挂载点。
- `document`：脱离 Core 内部状态的 JSON 副本。
- `readOnly`：当前是否有写入权。
- `onEdit(operations, expectedRevision)`：原子提交，失败抛出错误，返回新文档。
- `onUndo()` / `onRedo()`：单事务撤销/重做。
- `onSave()`：等待 IndexedDB 实际完成写入。

编辑器应在自己的操作结束时批量提交，不可直接改变 Core 内部对象。重绘只使用 `update` 传回的新快照。失去租约后的任何 `onEdit` 会拒绝；同时会调用可选的 `setReadOnly(true)` 通知编辑器禁用交互。

## 接入检查契约

1. 读取实际 schema、资源表示和画布渲染器；决定适配层映射。
2. 保留未知属性及编辑元信息，补充迁移测试；不能丢弃不支持的数据。
3. 将现有 commit/undo/redo 收敛到同一事务入口，验证拖动一次只产生一次历史。
4. 接入真实渲染/动画运行时以取代基础 SVG renderer。
5. 再运行 UI、持久化、离线 HTML 及 MCP → 浏览器文件交接端到端测试。

MCP 当前是文件模式。它与浏览器 IndexedDB 不会自动同步，需通过 HTML 导出/导入交换；实时配对/通信不在本包实现。
