import {CloudAPI} from '../storage/cloud-project-store.js';
import {formDialog} from './admin/app.js';

const permissions = [['projects:read', '读取项目', true], ['projects:create', '创建项目', true], ['projects:write', '编辑项目', true], ['projects:export', '导出项目', true], ['projects:delete', '删除和恢复项目', false], ['themes:read', '读取主题', true], ['themes:write', '保存个人主题', false], ['themes:publish', '发布个人主题新版本', false]];
const uuid = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
const date = value => value ? new Date(value).toLocaleString('zh-CN') : '—';

export async function mountTokenSettings({api = new CloudAPI(), container, document = container?.ownerDocument || globalThis.document, navigate = url => globalThis.location.assign(url)} = {}) {
 if (!container) {container = document.createElement('section'); (document.querySelector('main') || document.body).append(container);}
 container.classList.add('token-settings');
 const style = document.createElement('style'); style.textContent = '.token-settings{padding:24px 0}.token-settings h2{margin-bottom:12px}.token-settings p{font-size:12px;line-height:1.8;color:var(--muted)}.token-settings .token-toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.token-settings .token-row{border-top:1px solid var(--line);padding:18px 0;display:flex;justify-content:space-between;gap:20px}.token-settings .token-row strong{font-size:14px;font-weight:500}.token-settings .token-row small{display:block;color:var(--muted);font-size:11px;margin-top:8px;overflow-wrap:anywhere}.token-settings .token-row button{align-self:center;font-size:11px;padding:8px 12px}.token-settings .token-status.error{color:#873723}.sp-token-dialog label.checkbox{display:flex;gap:9px;align-items:center}.sp-token-dialog label.checkbox input{width:auto;margin:0}.sp-token-dialog textarea{display:block;width:100%;font:inherit;font-size:12px;padding:10px;background:transparent;border:1px solid var(--line);margin-top:8px}.token-secret{width:100%;padding:12px;font:12px monospace;overflow-wrap:anywhere}'; container.append(style);
 const heading = document.createElement('h2'); heading.textContent = 'Agent 授权'; container.append(heading);
 const description = document.createElement('p'); description.textContent = '为自己的项目创建限时授权。完整令牌仅显示一次，请保存到 Agent 的环境配置中。'; container.append(description);
 const status = document.createElement('p'); status.className = 'token-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); container.append(status);
 const toolbar = document.createElement('div'); toolbar.className = 'token-toolbar'; container.append(toolbar);
 const list = document.createElement('div'); container.append(list);
 let busy = false;
 function notice(text, error = false) {status.textContent = text; status.classList.toggle('error', error);}
 function report(error) {if (['UNAUTHENTICATED', 'ACCOUNT_CHANGED'].includes(error.code)) navigate('/login?returnTo=%2Fapp'); else notice(error.code === 'TIMEOUT' || error.code === 'OFFLINE' ? '请求结果未确认，请刷新授权列表核对。' : error.message || '操作失败，请重试。', true);}
 function button(text, task, write = false) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.className = 'secondary';
  if (write) {button.dataset.tokenWrite = ''; button.disabled = busy;}
  button.onclick = async () => {if (write && busy) return; if (write) {busy = true; for (const element of container.querySelectorAll('[data-token-write]')) element.disabled = true;} try {await task();} catch (error) {report(error);} finally {if (write) {busy = false; for (const element of container.querySelectorAll('[data-token-write]')) element.disabled = false;}}};
  return button;
 }
 async function oneTimeToken(token) {
  await new Promise(resolve => {
   const previous = document.activeElement, dialog = document.createElement('dialog'), title = document.createElement('h2'), note = document.createElement('p'), value = document.createElement('textarea');
   dialog.className = 'sp-token-dialog'; title.textContent = '保存你的授权令牌'; title.id = 'token-once-title'; dialog.setAttribute('aria-labelledby', title.id);
   note.textContent = '这是唯一一次显示完整令牌。关闭后无法再次查看；丢失时请撤销并重新创建。';
   value.value = token; value.readOnly = true; value.className = 'token-secret'; value.setAttribute('aria-label', '完整授权令牌'); value.rows = 3;
   const actions = document.createElement('div'); actions.className = 'dialog-actions';
   const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'secondary'; copy.textContent = '复制令牌';
   copy.onclick = async () => {try {await document.defaultView.navigator.clipboard.writeText(value.value); copy.textContent = '已复制';} catch {value.focus(); value.select(); note.textContent = '自动复制不可用，请选择令牌后手动复制。';}};
   const done = document.createElement('button'); done.type = 'button'; done.textContent = '我已保存';
   let finished = false;
   function finish() {if (finished) return; finished = true; value.value = ''; token = ''; dialog.close?.(); dialog.remove(); previous?.focus?.(); resolve();}
   done.onclick = finish; dialog.addEventListener('cancel', event => {event.preventDefault(); finish();}); actions.append(copy, done); dialog.append(title, note, value, actions); document.body.append(dialog);
   if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', ''); value.focus(); value.select();
  });
 }
 async function create() {
  const fields = [{name: 'name', label: '授权名称', required: true, maxLength: 128}, ...permissions.map(([name, label, value]) => ({name, label, type: 'checkbox', value})), {name: 'projectMode', label: '项目范围', options: [['all', '自己的全部项目'], ['selected', '仅下方指定项目'], ['none', '不允许访问现有项目']]}, {name: 'projectAllowlist', label: '项目 ID（仅指定项目时填写，以逗号或换行分隔）', type: 'textarea'}, {name: 'expiresAt', label: '到期时间（留空为 30 天，最多 365 天）', type: 'datetime-local'}];
  const pending = formDialog(document, '创建 Agent 授权', fields, {message: '按 Agent 实际需要选择权限。默认不允许删除项目。', confirm: '创建授权'}); document.querySelector('dialog')?.classList.add('sp-token-dialog');
  const answer = await pending; if (!answer) return;
  const scopes = permissions.filter(([name]) => answer[name]).map(([name]) => name);
  if (!scopes.length) throw new Error('至少选择一项权限。');
  if (answer['projects:delete'] && !await formDialog(document, '允许删除项目', [], {message: '该 Agent 可以将授权范围内的项目移到回收站及恢复。确认授予此权限？', confirm: '允许删除'})) return;
  let projectAllowlist = null;
  if (answer.projectMode === 'none') projectAllowlist = [];
  if (answer.projectMode === 'selected') {projectAllowlist = answer.projectAllowlist.split(/[\s,，]+/).filter(Boolean); if (!projectAllowlist.length || projectAllowlist.some(id => !uuid.test(id))) throw new Error('请填写有效的项目 ID。'); projectAllowlist = [...new Set(projectAllowlist.map(id => id.toLowerCase()))];}
  const body = {name: answer.name, scopes, projectAllowlist, ...(answer.expiresAt ? {expiresAt: new Date(answer.expiresAt).toISOString()} : {})};
  const created = await api.request('/me/tokens', {method: 'POST', body});
  const token = created.token; delete created.token;
  await oneTimeToken(token); notice('授权已创建。'); await reload();
 }
 async function revoke(token) {if (!await formDialog(document, '撤销授权', [], {message: `使用“${token.name}”的 Agent 将立即失去访问权限。`, confirm: '撤销授权'})) return; await api.request(`/me/tokens/${encodeURIComponent(token.id)}`, {method: 'DELETE'}); notice('授权已撤销。'); await reload();}
 async function password() {
  const answer = await formDialog(document, '修改密码', [{name: 'currentPassword', label: '当前密码', type: 'password', required: true, maxLength: 1024, autocomplete: 'current-password'}, {name: 'newPassword', label: '新密码（至少 12 个字符）', type: 'password', required: true, minLength: 12, maxLength: 1024, autocomplete: 'new-password'}], {message: '修改后所有浏览器会话将退出，请使用新密码重新登录。', confirm: '修改密码'});
  if (!answer) return;
  try {await api.request('/auth/password', {method: 'POST', body: answer}); navigate('/login?returnTo=%2Fapp');} finally {answer.currentPassword = ''; answer.newPassword = '';}
 }
 toolbar.append(button('创建授权', create, true), button('刷新列表', reload), button('修改密码', password, true));
 async function reload() {
  list.setAttribute('aria-busy', 'true'); list.replaceChildren(); const loading = document.createElement('p'); loading.textContent = '正在读取授权…'; list.append(loading);
  try {
   const tokens = await api.request('/me/tokens'); list.replaceChildren();
   if (!tokens.length) {const empty = document.createElement('p'); empty.textContent = '暂无授权。创建一份限时授权后，即可让 Agent 访问自己的项目。'; list.append(empty);}
   for (const token of tokens) {
    const row = document.createElement('div'); row.className = 'token-row'; const info = document.createElement('div'), name = document.createElement('strong'); name.textContent = token.name; info.append(name);
    for (const text of [token.prefix + '…', token.scopes.join('、'), token.projectAllowlist === null ? '自己的全部项目' : `限定 ${token.projectAllowlist.length} 个项目`, '到期：' + date(token.expiresAt), token.revokedAt ? '已撤销' : Date.parse(token.expiresAt) <= Date.now() ? '已到期' : '有效']) {const small = document.createElement('small'); small.textContent = text; info.append(small);}
    row.append(info); if (!token.revokedAt) row.append(button('撤销授权', () => revoke(token), true)); list.append(row);
   }
  } catch (error) {list.replaceChildren(); report(error);} finally {list.setAttribute('aria-busy', 'false');}
 }
 try {if (!api.user) await api.restoreSession(); await reload();} catch (error) {report(error);}
 return {reload, destroy() {container.replaceChildren();}};
}
