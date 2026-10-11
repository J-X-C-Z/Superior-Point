# Codex 与 Claude Code 接入

本文说明如何把 Superior Point 的 MCP 工具接到 Codex 或 Claude Code。两种客户端都在你的电脑上启动 stdio MCP 进程；云端模式由本机 Bridge 使用 HTTPS 调用 Superior Point API。

## 先选连接方式

| 方式 | 数据位置 | 适用情况 |
| --- | --- | --- |
| 本地文件 MCP | 你指定的本地目录 | 独立使用本地项目文件；不需要账号或 PAT |
| 云端 Bridge | Superior Point 云端 API / PostgreSQL | 读取和编辑登录账号有权访问的云端项目；需要 PAT |

本地 MCP 只访问显式指定目录中的 `{projectId}.json` 和导入/导出的 HTML。它不会连接浏览器里的 IndexedDB。云端 Bridge 才能访问云端工作台的同一份项目。当前接入方式是本机 stdio Bridge；本指南不提供远程 HTTP MCP 或 OAuth 连接。

开始前，安装 Node.js 22 或更新版本，并在仓库目录安装依赖：

```sh
npm ci
```

以下命令中的 `/absolute/path/to/Superior-Point` 要替换为本仓库的绝对路径；目录路径要使用你授权给 Agent 的真实目录。

## 本地文件 MCP

选择一个用于本地项目文件的目录。MCP 可在该目录创建、读取、编辑项目 JSON，也可从其中导入 HTML 或将导出文件保存回该目录。目录不存在时会创建；使用你明确授权的目录路径。

### Codex

在终端运行：

```sh
codex mcp add superior-point-local -- node /absolute/path/to/Superior-Point/mcp/server.js --project-root /absolute/path/to/authorized-projects
codex mcp list
```

重新打开 Codex 会话后，在 Codex TUI 输入 `/mcp` 确认连接；桌面应用与 CLI 共用 MCP 配置。IDE 扩展可在设置的 MCP servers 页面添加同一条 stdio 命令。

### Claude Code

在仓库目录运行以下命令，将它添加到当前项目的本地配置：

```sh
claude mcp add --transport stdio superior-point-local -- node /absolute/path/to/Superior-Point/mcp/server.js --project-root /absolute/path/to/authorized-projects
claude mcp list
```

重启或重新打开 Claude Code 会话，再输入 `/mcp` 查看连接与工具列表。此命令默认添加到本地 scope；若希望对所有项目启用，在命令中加 `--scope user`。

本地 MCP 提供 `sp_create_project`、`sp_open_project`、`sp_get_document`、`sp_get_slide`、`sp_edit`、`sp_render_slide`、`sp_validate`、`sp_save_export`。它没有项目列表工具；读取现有项目时，使用本地 `{projectId}.json` 文件名中的 ID 调用 `sp_get_document`。首次验证可调用 `sp_create_project` 创建测试项目，再用返回的 ID 调用 `sp_get_document`。

## 云端 MCP Bridge

先在 Superior Point 中创建一个有需要权限和项目范围的 PAT。只在创建时复制完整 PAT，保存到本机安全的环境变量或密钥管理器。需要列出/读取项目时授予 `projects:read`；创建、编辑、导出分别还需 `projects:create`、`projects:write`、`projects:export`。可设置到期时间和项目允许列表；遵循最小权限。PAT 只对其所属账号授权范围内的项目有效。

云端模式需要 HTTPS API **origin**，例如 `https://sp.example.com`，不能带 API 路径、查询参数或凭据。设置这两个环境变量后，确保启动 Codex 或 Claude Code 的进程能继承它们：

```text
SP_API_URL=https://你的服务域名
SP_API_TOKEN=你的PAT
```

不要把真实 PAT 放进命令行参数、仓库、共享配置、日志或截图。不要在共享的项目 MCP 配置中写入明文凭据。

本机开发服务如确需 HTTP，只能使用 `localhost`、`127.0.0.1` 或 `::1`，并在 Bridge 进程环境中显式设置 `SP_BRIDGE_ALLOW_HTTP=1`。Codex 还需在 `env_vars` 中加入该变量；Claude Code 配置的 `env` 需加入 `"SP_BRIDGE_ALLOW_HTTP": "1"`。公网 HTTP 不受支持。

云端 Bridge 的文件导入和导出是可选功能，需要再授权一个已存在、真实且不经过符号链接的本地目录。只做云端列表、读取、编辑和验证时不需要该目录。

### Codex

Codex 的 CLI、桌面应用和 IDE 扩展共用 `~/.codex/config.toml`。用安全方式让启动 Codex 的本机进程获得 `SP_API_URL` 和 `SP_API_TOKEN` 后，添加 Bridge：

```sh
codex mcp add superior-point-cloud -- node /absolute/path/to/Superior-Point/mcp/bridge/server.js
```

如果需要从本地 HTML 导入或将导出保存到磁盘，将命令改为：

```sh
codex mcp add superior-point-cloud -- node /absolute/path/to/Superior-Point/mcp/bridge/server.js --root /absolute/path/to/authorized-import-export
```

`--root` 是本机导入/导出目录，不是云端项目副本。添加后，编辑 `~/.codex/config.toml` 中 `[mcp_servers.superior-point-cloud]` 项，加入 `env_vars = ["SP_API_URL", "SP_API_TOKEN"]`，让 Codex 从启动环境转发这两个变量；不要把变量值写进 TOML。随后运行 `codex mcp list`，重启会话并用 `/mcp` 检查连接。

### Claude Code

在使用 Claude Code 的项目根目录创建或合并 `.mcp.json`，配置环境变量引用而不是 PAT 明文。Claude Code 会在启动 MCP 进程时展开这些引用：

```json
{
  "mcpServers": {
    "superior-point-cloud": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/Superior-Point/mcp/bridge/server.js"
      ],
      "env": {
        "SP_API_URL": "${SP_API_URL}",
        "SP_API_TOKEN": "${SP_API_TOKEN}"
      }
    }
  }
}
```

若要启用本地 HTML 导入/导出，在 `args` 数组末尾增加 `"--root", "/absolute/path/to/authorized-import-export"`。环境变量必须在启动 Claude Code 的本机进程中可用。不要把个人 PAT 写入共享文件；含个人连接的 `.mcp.json` 不要提交。

使用 `claude mcp list` 查看配置，在 Claude Code 会话中输入 `/mcp` 确认已连接并显示工具。需对所有项目启用时，可将配置放入 Claude Code 的 user scope；继续使用环境变量注入 PAT。

## 连接验证

云端验证：确认客户端显示服务器已连接且工具可用，然后让 Agent 调用 `sp_list_projects` 并读取列表中你有权访问的一个 `projectId`：

```text
调用 sp_list_projects，然后对其中一个项目调用 sp_get_document，返回项目标题、ID 和 revision。
```

云端 Bridge 的 `sp_list_projects` 只列出 PAT 授权账号可访问的项目，`sp_get_document` 返回服务端权威文档。首次只验证时用读取操作即可。确认读回正确后，再进行编辑或导出。连接状态成功不等于项目权限已覆盖；实际读回是验证授权范围的依据。

若选择本地模式，使用已有 JSON 文件名中的 ID 调用 `sp_get_document`，或创建测试项目后读回。它不会列出云端项目。

## 常见问题

- **服务器启动失败**：确认 Node.js 为 22+、仓库依赖已安装、命令和仓库路径正确。云端模式还要确认 API URL 是 HTTPS origin，且 `SP_API_TOKEN` 已传给 Bridge 进程。
- **`401` 或 `TOKEN_REQUIRED`**：确认 PAT 未过期、未撤销，环境变量没有空值或多余换行；不要把 PAT 粘贴到聊天或错误报告。
- **`403` 或项目未出现在列表中**：检查 PAT 的 Scope 和项目允许列表；列表只包含该账号有权访问的项目。
- **`ROOT_REQUIRED`**：HTML 导入/导出没有配置 `--root`；指定本机授权目录后重启 MCP。纯云端项目读取不需要配置它。
- **`INVALID_API_URL`**：Bridge 只接受 HTTPS origin。HTTP 只允许显式开启的本机回环开发服务，不能用于公网服务。
- **连接后工具列表未更新**：关闭并重新打开会话，检查 `codex mcp list` 或 `claude mcp list` 及客户端 `/mcp` 页面。Claude Code 的 `claude mcp get superior-point-cloud` 可检查该项配置。

## PAT 撤销

在云端工作台账号面板展开“Agent 授权与账号设置”，在授权列表撤销该 PAT。撤销后，Bridge 的后续云端调用会被拒绝。随后从客户端 MCP 配置中移除服务器，清理启动环境或密钥管理器中的旧值；若怀疑令牌泄露，立即撤销并重新创建最小权限 PAT。完整 PAT 只在创建时显示，无法从令牌列表恢复。

## 官方客户端配置参考

- [OpenAI Codex：MCP 配置](https://developers.openai.com/codex/extend/mcp)
- [Anthropic：Claude Code MCP](https://code.claude.com/docs/en/mcp)
