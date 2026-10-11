const search = document.querySelector('#help-search');
const sections = [...document.querySelectorAll('.help-section')];
const navLinks = [...document.querySelectorAll('.side-nav a')];
const status = document.querySelector('#search-status');
const noResults = document.querySelector('#no-results');

const permissions = document.querySelector('#permissions');
if (permissions) {
  const heading = document.createElement('h3');
  heading.className = 'subheading';
  heading.textContent = '存储、登录会话与分享链接';
  const lifecycle = document.createElement('ul');
  lifecycle.className = 'plain-list';
  const guidance = [
    ['存储配额', '配额统计保留的项目、历史、主题、回执和固定分享页面；移入回收站不会释放留存数据，过期或撤销的分享快照仍计入用量。这不是云主机物理磁盘上限。达到上限可能阻止新增或扩容，现有内容不会自动删除。'],
    ['登录会话', '“活跃登录会话”只列出当前账号的浏览器会话。退出单个会话不会删除项目；修改密码会退出全部浏览器会话，但不会自动撤销 PAT。'],
    ['固定分享', '只有项目所有者的有效网页登录会话能创建或撤销链接；PAT、OAuth 或管理员身份本身不能代替所有权。链接展示创建时保存的只读修订；工作台当前提供 7 天有效链接，服务端上限为 30 天。到期后需新建。未到期且未撤销的链接可能在回收站项目或停用账号恢复后重新可用；点“撤销”会永久失效，但不能收回访客已保存的内容。']
  ];
  for (const [labelText, descriptionText] of guidance) {
    const row = document.createElement('li');
    const label = document.createElement('span');
    const description = document.createElement('span');
    label.textContent = labelText;
    description.textContent = descriptionText;
    row.append(label, description);
    lifecycle.append(row);
  }
  permissions.append(heading, lifecycle);
}

function applySearch() {
  const query = search.value.trim().toLocaleLowerCase('zh-CN');
  let visible = 0;
  for (const section of sections) {
    const isFAQ = section.id === 'faq';
    const items = isFAQ ? [...section.querySelectorAll('.faq-item')] : [];
    if (isFAQ) {
      let visibleItems = 0;
      for (const item of items) {
        const matches = !query || `${item.dataset.search || ''} ${item.textContent}`.toLocaleLowerCase('zh-CN').includes(query);
        item.hidden = !matches;
        if (matches) visibleItems += 1;
      }
      section.hidden = query ? visibleItems === 0 : false;
      if (!section.hidden) visible += 1;
    } else {
      const haystack = `${section.dataset.search || ''} ${section.textContent}`.toLocaleLowerCase('zh-CN');
      section.hidden = !!query && !haystack.includes(query);
      if (!section.hidden) visible += 1;
    }
    const link = navLinks.find((item) => item.hash === `#${section.id}`);
    if (link) link.hidden = section.hidden;
  }
  noResults.hidden = !query || visible > 0;
  status.textContent = query ? (visible ? `找到 ${visible} 个相关主题` : '没有匹配的帮助内容') : '浏览全部指南';
}

search.addEventListener('input', applySearch);
document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable) return;
  event.preventDefault();
  search.focus();
});

const copyButton = document.querySelector('.copy-button');
copyButton?.addEventListener('click', async () => {
  const code = copyButton.closest('.code-wrap').querySelector('code').textContent;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    const temporary = document.createElement('textarea');
    temporary.value = code;
    temporary.setAttribute('readonly', '');
    temporary.style.position = 'fixed';
    temporary.style.opacity = '0';
    document.body.append(temporary);
    temporary.select();
    document.execCommand('copy');
    temporary.remove();
  }
  copyButton.textContent = '已复制';
  window.setTimeout(() => { copyButton.textContent = '复制'; }, 1600);
});

const sectionObserver = new IntersectionObserver((entries) => {
  const visibleEntries = entries.filter((entry) => entry.isIntersecting && !entry.target.hidden);
  if (!visibleEntries.length) return;
  const current = visibleEntries.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0].target.id;
  for (const link of navLinks) {
    if (link.hash === `#${current}`) link.classList.add('active');
    else link.classList.remove('active');
  }
}, { rootMargin: '-10% 0px -75% 0px' });
for (const section of sections) sectionObserver.observe(section);
