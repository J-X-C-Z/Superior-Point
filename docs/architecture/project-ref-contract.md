# SP-041 / SP-042 项目引用契约

统一工作台聚合既有 ProjectStore、CloudProjectStore 与 CloudDraftStore，不合并权威数据。公开引用为 `ProjectRef={source:'local'|'cloud',projectId,accountId?}`；云端必须带账号。现有 UI 列表项保留 `id` 字段及 `record`，`projectRef(entry)` 可转换为公开引用。`WorkspaceLibrary` 与路线图术语 `UnifiedProjectLibrary` 指同一实现。

每个打开、复制、重命名、删除、恢复和导出按来源路由；相同 UUID/名称不构成关联。只有显式上传建立来源修订与云端新 UUID 的映射。映射修订过旧显示本地已修改，不声称云端同步。

云端账号固定在浏览器请求的 `X-SP-Account-ID`。服务端验证会话所属账号，相同浏览器其他标签页切换账号后拒绝读取/写入旧工作区；客户端清空旧身份，文稿草稿按原账号继续保留。PAT 不使用此浏览器身份机制，仍由 Token 所属账号、Scope、项目允许列表和业务服务检查。

恢复草稿不是云端权威内容。恢复中心可另存为本地副本（保留原草稿），或在线创建独立云端恢复项目。任何未确认内容/编辑器快照、CAS 或租约失败不得丢弃恢复草稿。

主题扩展位于 `document.extensions.theme`，不改旧 IndexedDB 项目 schema，不批量改写无主题旧文稿。见 [主题契约](theme-contract.md)。

验证覆盖来源碰撞、上传回读、离线、同账号换 Store、跨账号请求固定、草稿恢复、Core/CAS 与 MCP 原子操作。实际浏览器、真实 stdio/服务、部署和生产灾备是独立验收层。
