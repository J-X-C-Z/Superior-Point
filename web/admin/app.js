import {mountObservability} from './observability.js';
import {CloudAPI} from '../../storage/cloud-project-store.js';

const sections = {
 observability: ['运行统计', '查看 Agent 调用记录和实际资源状态。'],
 dashboard: ['平台概览', '检查服务、用户和存储状态。'], users: ['用户', '创建账号，管理角色、登录会话和账号状态。'],
 projects: ['项目', '管理归属和回收站。此处仅展示项目元数据。'], tokens: ['Agent 授权', '查看授权范围和有效期，撤销不再使用的授权。'],
 storage: ['存储配额', '按账号查看保留数据用量、全局限额和告警。'],
 audit: ['审计记录', '查看安全与管理操作的时间、操作人和结果。'], settings: ['系统设置', '调整站点信息、上传上限、维护状态和全局存储配额。'], backups: ['备份与恢复验证', '创建服务备份，并在独立数据库中检查恢复结果。'],
};
const date = value => value ? new Date(value).toLocaleString('zh-CN') : '—';
const bytes = value => value >= 1048576 ? (value / 1048576).toFixed(1) + ' MiB' : (value / 1024).toFixed(1) + ' KiB';
const storageBytes = value => {const units=['B','KiB','MiB','GiB','TiB'];let amount=Number(value)||0,index=0;while(amount>=1024&&index<units.length-1){amount/=1024;index++;}return `${index?amount.toFixed(1):amount} ${units[index]}`;};

export function formDialog(document, title, fields = [], {message = '', confirm = '确认'} = {}) {
 return new Promise(resolve => {
  const previous = document.activeElement, dialog = document.createElement('dialog'), form = document.createElement('form'), heading = document.createElement('h2');
  heading.textContent = title; heading.id = 'admin-dialog-heading'; dialog.setAttribute('aria-labelledby', heading.id); form.append(heading);
  if (message) {const p = document.createElement('p'); p.textContent = message; form.append(p);}
  const controls = new Map();
  for (const field of fields) {
   const label = document.createElement('label'); label.textContent = field.label;
   const input = document.createElement(field.options ? 'select' : field.type === 'textarea' ? 'textarea' : 'input');
   input.name = field.name;
   if (field.options) for (const [value, text] of field.options) {const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option);}
   else if (field.type !== 'textarea') input.type = field.type || 'text';
   for (const key of ['required', 'minLength', 'maxLength', 'pattern', 'autocomplete', 'placeholder', 'min', 'max']) if (field[key] !== undefined) input[key] = field[key];
   if (field.type === 'checkbox') {label.className = 'checkbox'; input.checked = Boolean(field.value); label.prepend(input);} else {if (field.value !== undefined) input.value = field.value; label.append(input);}
   form.append(label); controls.set(field.name, input);
  }
  const actions = document.createElement('div'); actions.className = 'dialog-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = '取消';
  const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = confirm;
  actions.append(cancel, submit); form.append(actions); dialog.append(form); document.body.append(dialog);
  let finished = false;
  function finish(value) {if (finished) return; finished = true; for (const input of controls.values()) {input.value = ''; if (input.type === 'checkbox') input.checked = false;} dialog.close?.(); dialog.remove(); previous?.focus?.(); resolve(value);}
  cancel.onclick = () => finish(null); dialog.addEventListener('cancel', event => {event.preventDefault(); finish(null);});
  form.addEventListener('submit', event => {event.preventDefault(); if (!form.reportValidity()) return; finish(Object.fromEntries([...controls].map(([name, input]) => [name, input.type === 'checkbox' ? input.checked : input.value])));});
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  (controls.values().next().value || submit).focus();
 });
}

export async function mountAdmin({document = globalThis.document, api = new CloudAPI(), navigate = url => globalThis.location.assign(url)} = {}) {
 const content = document.querySelector('#admin-content'), status = document.querySelector('#admin-status');
 let section = 'dashboard', offset = 0, rows = [], search = '', recordFilter='', trash = false, busy = false, poll = null, generation = 0;
 let observabilityView=null;
 const limit = 25;
 function node(tag, text, className) {const element = document.createElement(tag); if (text !== undefined) element.textContent = String(text); if (className) element.className = className; return element;}
 function notice(message, error = false) {status.textContent = message; status.classList.toggle('error', error); status.hidden = !message;}
 function report(error) {
  if (error.code === 'UNAUTHENTICATED' || error.code === 'ACCOUNT_CHANGED') {navigate('/login?returnTo=%2Fadmin'); return;}
  notice(error.code === 'TIMEOUT' || error.code === 'OFFLINE' ? '请求结果未确认。请先刷新列表核对，再决定是否重新操作。' : error.message || '操作失败，请刷新后重试。', true);
 }
 function button(text, task, {write = false, danger = false} = {}) {
  const item = node('button', text, danger ? 'danger' : 'secondary'); item.type = 'button';
  if (write) {item.dataset.write = ''; item.disabled = busy;}
  item.onclick = async () => {
   if (write && busy) return;
   if (write) {busy = true; for (const control of document.querySelectorAll('[data-write]')) control.disabled = true;}
   try {await task();} catch (error) {report(error);} finally {if (write) {busy = false; for (const control of document.querySelectorAll('[data-write]')) control.disabled = control.hasAttribute('data-unavailable');}}
  };
  return item;
 }
 async function request(path, options) {
  try {return await api.request(path, options);}
  catch (error) {
   if (error.code !== 'REAUTHENTICATION_REQUIRED') throw error;
   const answer = await formDialog(document, '重新验证密码', [{name: 'password', label: '当前密码', type: 'password', autocomplete: 'current-password', required: true, maxLength: 1024}], {message: '此操作需要最近完成的密码验证。', confirm: '验证并继续'});
   if (!answer) return null;
   try {await api.request('/auth/reauth', {method: 'POST', body: {password: answer.password}});} finally {answer.password = '';}
   return api.request(path, options);
  }
 }
 async function confirm(title, message) {return Boolean(await formDialog(document, title, [], {message, confirm: title}));}
 async function mutation(path, body, method = 'POST') {
  const result = await request(path, {method, body});
  if (result === null) return false;
  notice('操作已完成。'); await load(); return true;
 }
 function details(primary, secondary) {const cell = node('span', primary); if (secondary) cell.append(node('small', secondary)); return cell;}
 function toolbar({create, filters = true} = {}) {
  const bar = node('div', undefined, 'admin-toolbar'), left = node('div'), right = node('div');
  if (filters) {
   const input = document.createElement('input'); input.type = 'search'; input.placeholder = '搜索全部记录'; input.setAttribute('aria-label', '搜索全部记录'); input.value = search;
   input.oninput = () => {search = input.value;};input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();offset=0;load().catch(report);}};left.append(input,button('搜索',async()=>{offset=0;await load();}));
   const options=section==='users'?[['','全部状态'],['active','有效账号'],['disabled','已禁用']]:section==='tokens'?[['','全部状态'],['active','有效授权'],['expired','已过期'],['revoked','已撤销'],['disabled','账号已禁用']]:section==='audit'?[['','全部结果'],['success','成功'],['failure','失败']]:[];
   if(options.length){const select=document.createElement('select');select.setAttribute('aria-label','记录状态筛选');for(const [value,text]of options){const option=node('option',text);option.value=value;select.append(option);}select.value=recordFilter;select.onchange=()=>{recordFilter=select.value;offset=0;load().catch(report);};left.append(select);}
  }
  if (section === 'projects') {const select = document.createElement('select'); select.setAttribute('aria-label', '项目状态'); for (const [value, text] of [['false', '活跃项目'], ['true', '回收站']]) {const option = node('option', text); option.value = value; select.append(option);} select.value = String(trash); select.onchange = () => {trash = select.value === 'true'; offset = 0; load().catch(report);}; left.append(select);}
  right.append(button('刷新', load)); if (create) right.append(create); bar.append(left, right); content.append(bar);
 }
 function table(headers, records, cells) {
  const wrap = node('div', undefined, 'table-wrap'), table = document.createElement('table'), caption = node('caption', sections[section][0]); caption.hidden = true; table.append(caption);
  const head = document.createElement('thead'), header = document.createElement('tr'); for (const text of headers) {const cell = node('th', text); cell.scope = 'col'; header.append(cell);} head.append(header); table.append(head);
  const body = document.createElement('tbody');
  for (const record of records) {const row = document.createElement('tr'); for (const value of cells(record)) {const cell = document.createElement('td'); cell.append(value?.nodeType ? value : document.createTextNode(String(value ?? '—'))); row.append(cell);} body.append(row);}
  table.append(body); wrap.append(table); content.append(wrap);
  if (!records.length) content.append(node('p', search ? '当前页没有符合筛选条件的记录。' : '暂无记录。', 'empty-state'));
 }
 function actions(items) {const group = node('div', undefined, 'row-actions'); for (const item of items) group.append(item); return group;}
 function pages(total = null) {
  const page = node('div', undefined, 'pagination');
  const previous = button('上一页', async () => {offset -= limit; await load();}); previous.disabled = offset === 0;
  const next = button('下一页', async () => {offset += limit; await load();}); next.disabled = total === null ? rows.length < limit : offset + limit >= total;
  page.append(previous, node('span', `第 ${Math.floor(offset / limit) + 1} 页`), next); content.append(page);
 }
 function filtered() {return rows;}
 function renderTable() {
  const oldToolbar = content.querySelector('.admin-toolbar'); content.replaceChildren();
  if (oldToolbar) content.append(oldToolbar); else toolbar({create: section === 'users' ? button('创建用户', createUser, {write: true}) : null});
  if (section === 'users') table(['账号', '角色', '状态', '创建时间', '操作'], filtered(), user => [details(user.username, user.id), user.role === 'admin' ? '管理员' : '普通用户', user.status === 'active' ? '有效' : '已禁用', date(user.createdAt), actions([
   button('重置密码', () => resetPassword(user), {write: true}),
   button(user.status === 'active' ? '禁用' : '启用', () => statusUser(user), {write: true, danger: user.status === 'active'}),
   button(user.role === 'admin' ? '设为普通用户' : '设为管理员', () => roleUser(user), {write: true}),
   button('退出所有会话', () => revokeSessions(user), {write: true}),
   button('删除账号', () => deleteUser(user), {write: true, danger: true}),
  ])]);
  if (section === 'projects') table(['项目', '所有者', '修订', '更新时间', '操作'], filtered(), project => [details(project.title, project.id), details(project.ownerUsername, project.ownerId), project.revision, date(project.updatedAt), actions([
   button('转移归属', () => transferProject(project), {write: true}), button(trash ? '恢复' : '移到回收站', () => trashProject(project), {write: true, danger: !trash}),
  ])]);
  if (section === 'tokens') table(['授权', '所属用户', '权限与项目范围', '到期时间', '状态', '操作'], filtered(), token => [details(token.name, token.prefix + '…'), details(token.userUsername||token.userId,token.userUsername?token.userId:null), details(token.scopes.join('、'), token.projectAllowlist === null ? '自己的全部项目' : `限定 ${token.projectAllowlist.length} 个项目`), date(token.expiresAt), ({active:'有效',expired:'已到期',revoked:'已撤销',disabled:'账号已禁用'})[token.status] || (token.revokedAt ? '已撤销' : Date.parse(token.expiresAt) <= Date.now() ? '已到期' : '有效'), token.revokedAt ? '—' : actions([button('撤销授权', () => revokeToken(token), {write: true, danger: true})])]);
  if (section === 'audit') table(['时间', '操作人', '操作', '资源', '结果'], filtered(), event => [date(event.createdAt), event.actorId || '未登录', event.action, details(event.resourceType, event.resourceId), event.outcome === 'success' ? '成功' : '失败']);
  pages();
 }
 function renderStorage(data) {
  toolbar();
  const start=data.total?offset+1:0,end=Math.min(offset+rows.length,data.total);
  content.append(node('p',`共 ${data.total} 个账号 · 显示 ${start}–${end} 条`,'admin-detail'));
  table(['账号','项目数','存储配额','用量构成','告警'],rows,record=>{
   const usage=record.usage,quota=record.limits;
   const breakdown=node('div');
   for(const [label,key] of [['项目数据','projectBytes'],['历史','historyBytes'],['主题元数据','themeMetadataBytes'],['主题版本','themeVersionBytes'],['回执','receiptBytes'],['分享','shareBytes']])breakdown.append(details(label,storageBytes(usage[key])));
   const quotaDetail=node('span',`${usage.activeProjects} / ${quota.maxProjects} 个活跃项目`);quotaDetail.append(node('small',`${storageBytes(usage.totalBytes)} / ${storageBytes(quota.maxBytes)} · 告警线 ${quota.warningPercent}%`));
   const state=node('span',record.overQuota?'超出配额':record.warning?'接近配额':'正常',record.overQuota||record.warning?'error':'');state.setAttribute('role','status');
   return [details(record.username,record.userId),details(`${usage.activeProjects} 个活跃`,`${usage.trashedProjects} 个回收站项目`),quotaDetail,breakdown,state];
  });
  pages(data.total);
 }
 async function createUser() {
  const answer = await formDialog(document, '创建用户', [{name: 'username', label: '用户名', required: true, minLength: 3, maxLength: 64, pattern: '[A-Za-z0-9_.-]{3,64}', autocomplete: 'off'}, {name: 'password', label: '初始密码（至少 12 个字符）', type: 'password', required: true, minLength: 12, maxLength: 1024, autocomplete: 'new-password'}, {name: 'role', label: '角色', options: [['user', '普通用户'], ['admin', '管理员']]}], {confirm: '创建用户'});
  if (answer) try {await mutation('/admin/users', answer);} finally {answer.password = '';}
 }
 async function resetPassword(user) {const answer = await formDialog(document, '重置密码', [{name: 'password', label: '新密码（至少 12 个字符）', type: 'password', required: true, minLength: 12, maxLength: 1024, autocomplete: 'new-password'}], {message: `重置 ${user.username} 的密码后，该账号的所有登录会话都会退出。`, confirm: '重置密码'}); if (answer) try {if (await mutation(`/admin/users/${user.id}/reset-password`, answer) && user.id === api.user.id) navigate('/login?returnTo=%2Fadmin');} finally {answer.password = '';}}
 async function statusUser(user) {const disable = user.status === 'active'; if (await confirm(disable ? '禁用账号' : '启用账号', `${user.username}：${disable ? '所有登录会话及 Agent 授权会失效。' : '账号可重新登录；已撤销授权不会恢复。'}`)) if (await mutation(`/admin/users/${user.id}/status`, {status: disable ? 'disabled' : 'active'}, 'PATCH') && disable && user.id === api.user.id) navigate('/login');}
 async function roleUser(user) {const role = user.role === 'admin' ? 'user' : 'admin'; if (await confirm('变更角色', `将 ${user.username} 设为${role === 'admin' ? '管理员。管理员可以管理其他账号和平台设置。' : '普通用户。'}`)) if (await mutation(`/admin/users/${user.id}/role`, {role}, 'PATCH') && user.id === api.user.id && role === 'user') navigate('/app');}
 async function revokeSessions(user) {if (await confirm('退出所有会话', `${user.username} 的所有浏览器会话将退出。`)) if (await mutation(`/admin/users/${user.id}/sessions`, undefined, 'DELETE') && user.id === api.user.id) navigate('/login');}
 async function deleteUser(user) {if (await confirm('删除账号', `删除 ${user.username} 后，该账号将无法登录，所有 Agent 授权立即失效。文稿和审计记录会保留。此操作无法撤销。`) && await mutation(`/admin/users/${user.id}`, undefined, 'DELETE') && user.id === api.user.id) navigate('/login');}
 async function transferProject(project) {
  const query=await formDialog(document,'选择新所有者',[{name:'q',label:'搜索账号名称',maxLength:128}],{message:'按账号名称搜索有效用户；无需填写用户 ID。',confirm:'搜索账号'});if(!query)return;
  const users=await api.request('/admin/users?status=active&limit=100&q='+encodeURIComponent(query.q.trim()));
  if(!users.length){notice('没有匹配的有效账号，请重新搜索。',true);return;}
  const answer=await formDialog(document,'转移项目归属',[{name:'newOwnerId',label:'新所有者',options:users.map(user=>[user.id,user.username+(user.role==='admin'?'（管理员）':'')])}],{message:`转移“${project.title}”后原所有者失去访问权限；最多显示100条匹配，请用完整账号名称缩小范围。正在编辑的项目无法转移。`,confirm:'转移归属'});
  if(answer)await mutation(`/admin/projects/${project.id}/transfer`,{...answer,expectedRevision:project.revision,clientMutationId:crypto.randomUUID()});
 }
 async function trashProject(project) {if (await confirm(trash ? '恢复项目' : '移到回收站', `确认${trash ? '恢复' : '将'}“${project.title}”${trash ? '？' : '移到回收站？项目可恢复。'}`)) await mutation(`/admin/projects/${project.id}/${trash ? 'restore' : 'trash'}`, {expectedRevision: project.revision, clientMutationId: crypto.randomUUID()});}
 async function revokeToken(token) {if (await confirm('撤销授权', `撤销“${token.name}”后，使用该授权的 Agent 将立即失去访问权限。`)) await mutation(`/admin/mcp/tokens/${token.id}/revoke`, undefined);}
 function renderDashboard(data) {
  if(data.security?.warning)content.append(node('p',`异常登录提醒：最近 ${data.security.windowMinutes} 分钟已记录 ${data.security.failures} 次失败。请核查审计记录；此提醒不表示账号已被入侵。`,'error'));

  const list = node('dl', undefined, 'summary-list');
  for (const [label, value] of [['服务状态', data.service.status === 'ok' ? '在线' : data.service.status], ['有效账号 / 全部账号', `${data.users.active} / ${data.users.total}`], ['有效管理员', data.users.admins], ['活跃项目 / 回收站', `${data.projects.active} / ${data.projects.trash}`], ['有效 Agent 授权', data.tokens.active], ['文稿数据', bytes(data.storage.documentBytes)], ['数据库空间', bytes(data.storage.databaseBytes)]]) {const item = node('div'); item.append(node('dt', label), node('dd', value)); list.append(item);} content.append(list);
  content.append(node('p', '空间统计来自当前数据库；项目内容不会在后台预览。', 'admin-detail')); content.append(button('刷新状态', load));
 }
 function renderSettings(settings) {
  const form = node('form', undefined, 'settings-form'), controls = {};
  for (const [name, title, type] of [['siteName', '站点名称', 'text'], ['announcement', '公告', 'textarea'], ['maxUploadBytes', '上传上限（字节，最多 32 MiB）', 'number'], ['maintenanceMode', '开启维护模式', 'checkbox']]) {
   const label = node('label', title), input = document.createElement(type === 'textarea' ? 'textarea' : 'input'); input.name = name;
   if (type !== 'textarea') input.type = type;
   if (type === 'checkbox') {input.checked = settings[name]; label.prepend(input);} else {input.value = settings[name]; label.append(input);}
   if (name === 'siteName') {input.required = true; input.maxLength = 100;} if (name === 'announcement') input.maxLength = 2000;
   if (name === 'maxUploadBytes') {input.required = true; input.min = 1; input.max = 33554432;}
   controls[name] = input; form.append(label);
  }
  const quota=settings.storageQuota||{maxProjects:100,maxBytes:1073741824,warningPercent:80};
  const quotaFields=node('fieldset',undefined,'storage-quota-settings'),legend=node('legend','全局存储配额');quotaFields.append(legend);
  for(const [name,title,min,max] of [['maxProjects','每个账号最多活跃项目数',1,100000],['maxBytes','每个账号最大保留数据（字节）',1,10*1024**4],['warningPercent','配额告警阈值（百分比）',1,100]]){
   const label=node('label',title),input=document.createElement('input');input.type='number';input.name='storageQuota.'+name;input.required=true;input.min=min;input.max=max;input.step=1;input.value=quota[name];label.append(input);quotaFields.append(label);controls['storageQuota.'+name]=input;
  }
  quotaFields.append(node('p','阈值适用于每个账号的活跃项目数和保留数据总量；保留数据包含项目、历史、主题、回执和分享。该配额不是数据库物理磁盘上限。','admin-detail'));
  form.append(quotaFields);
  form.append(node('p', '公开注册保持关闭。账号由管理员创建。', 'admin-detail'));
  const save = button('保存设置', async () => {
   if (!form.reportValidity()) return;
   if (!await confirm('保存设置', '确认更新站点设置？维护模式会影响普通用户的云端写入。')) return;
   const patch = {siteName: controls.siteName.value, announcement: controls.announcement.value, maxUploadBytes: Number(controls.maxUploadBytes.value), maintenanceMode: controls.maintenanceMode.checked, publicRegistration: false, storageQuota:{maxProjects:Number(controls['storageQuota.maxProjects'].value),maxBytes:Number(controls['storageQuota.maxBytes'].value),warningPercent:Number(controls['storageQuota.warningPercent'].value)}};
   await mutation('/admin/settings', patch, 'PATCH');
  }, {write: true}); form.onsubmit = event => {event.preventDefault(); save.click();}; form.append(save); content.append(form);
 }
 function renderBackups(data) {
  toolbar({filters: false}); const bar = content.querySelector('.admin-toolbar>div:last-child');
  const running = data.jobs.some(job => ['queued', 'running'].includes(job.status));
  const start = button('创建备份', async () => {if (await confirm('创建备份', '将备份数据库和服务素材。任务在服务端执行，可在此查看进度。')) await mutation('/admin/backups', undefined);}, {write: true}); start.toggleAttribute('data-unavailable', !data.configured || running); start.disabled = busy || start.hasAttribute('data-unavailable');
  const restore = button('验证恢复', async () => {if (await confirm('验证恢复', '在独立数据库中恢复最新备份并核对内容。不会覆盖当前服务数据库。')) await mutation('/admin/backups/restore-check', undefined);}, {write: true}); restore.toggleAttribute('data-unavailable', !data.restoreConfigured || running || !data.jobs.some(job => ['completed', 'verified'].includes(job.status))); restore.disabled = busy || restore.hasAttribute('data-unavailable'); bar.append(start, restore);
  content.append(node('p', !data.configured ? '服务端尚未配置备份目录和数据库连接。请联系运维人员完成配置。' : data.restoreConfigured ? '备份和独立恢复验证均已配置。' : '备份已配置，独立恢复验证尚未配置。', 'admin-detail'));
  const labels = {queued: '等待执行', running: '执行中', completed: '备份完成', verified: '恢复验证通过', failed: '失败'};
  table(['任务', '状态', '创建时间', '完成时间'], data.jobs, job => [details(job.id, job.errorCode), labels[job.status] || job.status, date(job.createdAt), date(job.completedAt)]);
  if (data.jobs.some(job => ['queued', 'running'].includes(job.status))) poll = setTimeout(() => load().catch(report), 2000);
 }
 async function load() {
  observabilityView?.destroy();observabilityView=null;
  clearTimeout(poll); poll = null; const current = ++generation, target = section; content.setAttribute('aria-busy', 'true'); content.replaceChildren(node('p', '正在读取服务数据…', 'empty-state'));
  try {
   if(target==='observability'){content.replaceChildren();observabilityView=mountObservability({container:content,api});return;}
   let data;
   if (target === 'dashboard') {data = await api.request('/admin/dashboard');data.security=await api.request('/admin/security');}
   else if (target === 'settings') data = await api.request('/admin/settings');
   else if (target === 'backups') data = await api.request('/admin/backups');
   else data = await api.request(`/admin/${target === 'tokens' ? 'mcp/tokens' : target}?limit=${limit}&offset=${offset}${target === 'projects' ? '&trash=' + trash : ''}${search.trim()?'&q='+encodeURIComponent(search.trim()):''}${recordFilter?'&'+(target==='audit'?'outcome':'status')+'='+encodeURIComponent(recordFilter):''}`);
   if (current !== generation) return;
   content.replaceChildren(); if (target === 'dashboard') renderDashboard(data); else if (target === 'settings') renderSettings(data); else if (target === 'backups') renderBackups(data); else if(target==='storage'){rows=data.rows;renderStorage(data);} else {rows = data; renderTable();}
  } catch (error) {if (current === generation) {content.replaceChildren(node('p', '读取失败。检查提示后刷新重试。', 'empty-state'), button('重新读取', load)); report(error);}} finally {if (current === generation) content.setAttribute('aria-busy', 'false');}
 }
 for (const nav of document.querySelectorAll('[data-section]')) nav.onclick = () => {section = nav.dataset.section; offset = 0; search = ''; recordFilter=''; notice(''); for (const item of document.querySelectorAll('[data-section]')) {item.classList.toggle('active', item === nav); item.setAttribute('aria-current', item === nav ? 'page' : 'false');} document.querySelector('#section-name').textContent = sections[section][0]; document.querySelector('#admin-title').textContent = sections[section][0]; document.querySelector('#admin-description').textContent = sections[section][1]; load().catch(report);};
 document.querySelector('#admin-logout').onclick = async () => {try {await api.logout(); navigate('/login');} catch (error) {report(error);}};
 try {await api.restoreSession(); if (api.user.role !== 'admin') {notice('此账号没有管理后台访问权限。请返回创作工作台。', true); content.replaceChildren();} else {document.querySelector('#admin-account').textContent = api.user.username; await load();}} catch (error) {report(error);}
 return {reload: load, destroy() {observabilityView?.destroy();clearTimeout(poll); generation++;}};
}

if (typeof document !== 'undefined' && document.querySelector('[data-admin-root]')) mountAdmin().catch(() => {});
