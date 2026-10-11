import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountAgentGuide} from '../web/agent-guide.js';

test('agent guide mounts selectable client instructions and only uses a same-origin cloud URL', async () => {
 const dom = new JSDOM('<main id="guide"></main>', {url: 'https://sp.example.test/app'});
 try {
  const root = mountAgentGuide({container: dom.window.document.querySelector('main'), cloudURL: 'https://sp.example.test'});
  const details = [...root.querySelectorAll('details')];
  assert.equal(details.length, 3);
  assert.deepEqual(details.map(item => item.querySelector('summary').textContent), ['Codex 接入', 'Claude Code 接入', '其他 stdio MCP 客户端']);
  assert.match(root.textContent, /mcp\/server\.js/);
  assert.match(root.textContent, /mcp\/bridge\/server\.js/);
  assert.match(root.textContent, /SP_API_TOKEN/);
  assert.match(root.textContent, /https:\/\/sp\.example\.test/);
  assert.match(root.textContent, /sp_list_projects/);
  assert.match(root.textContent, /sp_get_document/);
  assert.doesNotMatch(root.textContent, /SP_BRIDGE_ALLOW_HTTP/);
  assert.doesNotMatch(root.textContent, /sp_pat_[A-Za-z0-9_-]+/);
  const copy = root.querySelector('button');
  copy.click();
  assert.equal(dom.window.getSelection().toString(), copy.parentElement.querySelector('code').textContent);
  assert.equal(copy.textContent, '已选中，请复制');
 } finally { dom.window.close(); }
});

test('agent guide enables Bridge HTTP only for same-origin loopback and rejects public HTTP', () => {
 const local = new JSDOM('<main></main>', {url: 'http://127.0.0.1:8791/app'});
 try {
  const root = mountAgentGuide({container: local.window.document.querySelector('main'), cloudURL: 'http://127.0.0.1:8791'});
  assert.match(root.textContent, /SP_API_URL=http:\/\/127\.0\.0\.1:8791/);
  assert.match(root.textContent, /SP_BRIDGE_ALLOW_HTTP/);
  assert.match(root.textContent, /SP_BRIDGE_ALLOW_HTTP=1/);
  assert.match(root.textContent, /公网 HTTP 不受支持/);
 } finally { local.window.close(); }

 for (const [pageURL, cloudURL] of [
  ['https://sp.example.test/app', 'https://other.example.test'],
  ['https://sp.example.test/app', 'file:///tmp/Superior-Point'],
  ['http://sp.example.test/app', 'http://sp.example.test'],
 ]) {
  const dom = new JSDOM('<main></main>', {url: pageURL});
  try {
   const root = mountAgentGuide({container: dom.window.document.querySelector('main'), cloudURL});
   assert.match(root.textContent, /https:\/\/你的Superior-Point域名/);
   assert.doesNotMatch(root.textContent, /https:\/\/other\.example\.test/);
   assert.doesNotMatch(root.textContent, /SP_BRIDGE_ALLOW_HTTP/);
  } finally { dom.window.close(); }
 }
});
