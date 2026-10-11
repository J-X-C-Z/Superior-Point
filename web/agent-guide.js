const REPO = "/absolute/path/to/Superior-Point";
const LOCAL_ROOT = "/absolute/path/to/authorized-projects";
const API_PLACEHOLDER = "https://你的Superior-Point域名";

function trustedCloudConfig(value, document) {
 try {
  const candidate = new URL(value, document.defaultView?.location?.href);
  const page = new URL(document.defaultView?.location?.href);
  if (candidate.origin !== page.origin) return {origin: API_PLACEHOLDER, allowLoopbackHttp: false};
  if (candidate.protocol === "https:") return {origin: candidate.origin, allowLoopbackHttp: false};
  if (candidate.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(candidate.hostname)) {
   return {origin: candidate.origin, allowLoopbackHttp: true};
  }
  return {origin: API_PLACEHOLDER, allowLoopbackHttp: false};
 } catch { return {origin: API_PLACEHOLDER, allowLoopbackHttp: false}; }
}

function codeBlock(document, text) {
 const wrapper = document.createElement("div");
 wrapper.className = "agent-guide-example";
 const pre = document.createElement("pre");
 const code = document.createElement("code");
 code.textContent = text;
 pre.append(code);
 const button = document.createElement("button");
 button.type = "button";
 button.textContent = "复制示例";
 button.addEventListener("click", async () => {
  try {
   const clipboard = document.defaultView?.navigator?.clipboard;
   if (!clipboard?.writeText) throw new Error("Clipboard API unavailable");
   await clipboard.writeText(text);
   button.textContent = "已复制";
  } catch {
   const range = document.createRange();
   range.selectNodeContents(code);
   const selection = document.defaultView?.getSelection();
   selection?.removeAllRanges();
   selection?.addRange(range);
   button.textContent = "已选中，请复制";
  }
 });
 wrapper.append(pre, button);
 return wrapper;
}

export function mountAgentGuide({container, document = container.ownerDocument, cloudURL = globalThis.location?.origin} = {}) {
 const root = document.createElement("section");
 root.className = "agent-guide";
 const intro = document.createElement("p");
 intro.textContent = "Superior Point 当前通过本机 stdio Bridge 连接 MCP 客户端，再由 Bridge 使用 HTTPS 和 PAT 访问云端。需要 Node.js 22+，以及本机克隆的 Superior Point 仓库；当前没有远程 /mcp 或 OAuth 接入。";
 root.append(intro);
 const repo = `cd ${REPO}\nnpm ci`;
 const {origin: apiOrigin, allowLoopbackHttp} = trustedCloudConfig(cloudURL ?? document.defaultView?.location?.origin, document);
 const bridgeEnvVars = ["SP_API_URL", "SP_API_TOKEN", ...(allowLoopbackHttp ? ["SP_BRIDGE_ALLOW_HTTP"] : [])];
 const loopbackNote = allowLoopbackHttp
  ? "本地回环 HTTP 默认会被 Bridge 拒绝；仅此开发地址需要把 SP_BRIDGE_ALLOW_HTTP=1 加入 Bridge 进程环境。公网 HTTP 不受支持。"
  : "生产地址必须使用 HTTPS；公网 HTTP 不受支持。";
 const clients = [
  {
   name: "Codex",
   local: `codex mcp add superior-point-local -- node ${REPO}/mcp/server.js --project-root ${LOCAL_ROOT}\ncodex mcp list\n# 重新打开会话后，在 TUI 中运行 /mcp`,
   cloud: `codex mcp add superior-point-cloud -- node ${REPO}/mcp/bridge/server.js\n# 在 ~/.codex/config.toml 的 [mcp_servers.superior-point-cloud] 下加入：\nenv_vars = ${JSON.stringify(bridgeEnvVars)}\n# 在启动 Codex 的本机进程环境中设置 SP_API_URL=${apiOrigin} 和 SP_API_TOKEN${allowLoopbackHttp ? "\n# 开发回环 HTTP 还需设置 SP_BRIDGE_ALLOW_HTTP=1" : ""}\ncodex mcp list\n# 重新打开会话后，在 TUI 中运行 /mcp`,
   note: "桌面应用、CLI 和 IDE 扩展共用 Codex MCP 配置。若需云端 HTML 导入/导出，可在 Bridge 命令末尾加 --root /你授权的本机目录。",
  },
  {
   name: "Claude Code",
   local: `claude mcp add --transport stdio superior-point-local -- node ${REPO}/mcp/server.js --project-root ${LOCAL_ROOT}\nclaude mcp list\n# 重新打开会话后运行 /mcp`,
   cloud: JSON.stringify({mcpServers:{"superior-point-cloud":{type:"stdio",command:"node",args:[`${REPO}/mcp/bridge/server.js`],env:{SP_API_URL:apiOrigin,SP_API_TOKEN:"${SP_API_TOKEN}",...(allowLoopbackHttp?{SP_BRIDGE_ALLOW_HTTP:"1"}:{})}}},},null,2),
   note: "把云端示例合并到项目 .mcp.json；启动 Claude Code 的本机进程须已设置 SP_API_TOKEN。若需云端 HTML 导入/导出，在 args 数组末尾增加 --root 和你授权的本机目录。",
  },
 ];
 const steps = document.createElement("ol");
 steps.className = "agent-guide-steps";
 const addStep = (title, content) => {
  const item = document.createElement("li");
  const heading = document.createElement("h3");
  heading.textContent = title;
  item.append(heading, content);
  steps.append(item);
 };
 const tokenIntro = document.createElement("p");
 tokenIntro.textContent = "创建仅用于此客户端的 PAT。首次显示时保存到本机密钥管理器或安全环境变量；页面不会再次显示完整令牌。";
 addStep("① 创建令牌", tokenIntro);
 const install = document.createElement("div");
 const installText = document.createElement("p");
 installText.textContent = "克隆仓库后在仓库目录安装依赖。将示例路径替换为本机实际路径。";
 install.append(installText, codeBlock(document, repo));
 addStep("② 安装 Bridge", install);
 const configure = document.createElement("div");
 const osNote = document.createElement("p");
 osNote.textContent = "macOS/Linux 可从密钥管理器或启动客户端的 shell 环境注入变量；Windows 可从密钥管理器或用户环境变量注入。设置后重新启动客户端，让其子进程继承 SP_API_URL 和 SP_API_TOKEN。不要把 PAT 放进命令参数、仓库或共享配置。";
 configure.append(osNote);
 addStep("③ 配置客户端", configure);
 for (const client of clients) {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = `${client.name} 接入`;
  details.append(summary);
  const cloud = document.createElement("p");
  cloud.textContent = `云端读取需要 projects:read；创建、编辑、导出分别需要 projects:create、projects:write、projects:export。仅按任务授予最小 Scope，并限制项目范围和到期时间；projects:delete 默认不要授予。${loopbackNote}`;
  details.append(cloud, codeBlock(document, client.cloud));
  const localTitle = document.createElement("h4"); localTitle.textContent = "可选：本地文件 MCP";
  const localText = document.createElement("p"); localText.textContent = "本地模式仅访问授权目录中的项目文件，不读取浏览器项目库，也没有云端项目列表工具。";
  details.append(localTitle, localText, codeBlock(document, client.local));
  const note = document.createElement("p");
  note.textContent = client.note;
  details.append(note);
  configure.append(details);
 }
 const generic = document.createElement("details");
 const genericTitle = document.createElement("summary"); genericTitle.textContent = "其他 stdio MCP 客户端";
 const genericText = document.createElement("p"); genericText.textContent = "在客户端新增 stdio MCP server：transport 选 stdio，command 设为 node，args 指向本机仓库的 mcp/bridge/server.js；将 SP_API_URL 和 SP_API_TOKEN 配为环境变量引用。具体字段名按客户端配置格式填写，禁止把 PAT 明文写入共享配置。";
 generic.append(genericTitle, genericText, codeBlock(document, JSON.stringify({transport:"stdio",command:"node",args:[`${REPO}/mcp/bridge/server.js`],env:{SP_API_URL:"${SP_API_URL}",SP_API_TOKEN:"${SP_API_TOKEN}"}},null,2)));
 configure.append(generic);
 const verify = document.createElement("div");
 const verifyText = document.createElement("p");
 verifyText.textContent = "重新打开客户端会话，在 /mcp 或客户端 MCP 列表确认已连接；云端先调用 sp_list_projects，再用返回的 projectId 调用 sp_get_document，核对标题和 revision 后再进行写操作。";
 verify.append(verifyText);
 addStep("④ 测试连接", verify);
 const use = document.createElement("p");
 use.textContent = "使用时先读取目标项目和 revision。需要编辑时仅对授权项目操作；导入/导出需要 projects:export，并且可选配置本机授权目录。若令牌疑似泄露，立即在 Agent 授权列表撤销，再从客户端配置中移除旧连接。完整 PAT 之后只显示前缀和元数据。";
 addStep("⑤ 使用与撤销", use);
 const errors = document.createElement("p");
 errors.className = "agent-guide-errors";
 errors.textContent = "常见诊断：401 表示 PAT 缺失、过期或已撤销；403 检查 Scope 与项目范围；409 表示修订冲突或项目正被占用，先重新读取再决定；超时表示结果未确认，先读回核对，禁止盲目重复写入。";
 root.append(steps, errors);
 container.append(root);
 return root;
}
