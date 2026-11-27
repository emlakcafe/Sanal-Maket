/* Run with: node tests/test_agent_ui.js. Offline job-state and trust-boundary checks. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'agent-ui.js'), 'utf8');
new vm.Script(source);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if (match[1].trim()) new vm.Script(match[1]);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size, 'HTML IDs must remain unique');

function harness(responses) {
  const elements = new Map();
  const calls = [];
  function node(tag = 'div') {
    return {
      tag, children: [], dataset: {}, history: [],
      classList: {toggle(key, value) { this[key] = !!value; }, add(key) { this[key] = true; }, remove(key) { this[key] = false; }},
      set textContent(value) { this._text = String(value); this.history.push(String(value)); },
      get textContent() { return this._text || ''; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; }
    };
  }
  const element = id => {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  };
  const window = {addEventListener() {}};
  const context = vm.createContext({window, document: {getElementById: element, createElement: node}, URL, Date, AbortController, setTimeout, clearTimeout, console,
    fetch: async (url, options) => {
      calls.push({url, options});
      assert(responses.length, 'Unexpected network call: ' + url);
      const response = responses.shift();
      if (typeof response === 'function') return response(url, options);
      return {ok: response.code ? response.code < 400 : true, status: response.code || 200, json: async () => response.data};
    }
  });
  vm.runInContext(source, context);
  return {api: window.AgentUI, element, calls};
}
function text(node) { return node.textContent + node.children.map(text).join(' '); }
const agents = status => [{id: 'parcel', name: 'Parsel görevi', engine: 'rules_and_tools', status, message: 'Gerçek sunucu mesajı'}, {id: 'search', name: 'Web araması', engine: 'rules_and_tools', status: 'complete'}];
const job = (status, state, extra = {}) => ({job_id: 'opaque-job-123456', status, agents: agents(state), active_agent_count: 99, poll_after_ms: 500, ai: {configured: false, running: false}, result: status === 'complete' ? {items: [], subject: null} : null, search_candidates: [], ...extra});
const input = {province: 'Yalova', district: 'Merkez', place: 'Hacımehmet', block: '1295', parcel: '4', zoning: 'unknown'};

(async () => {
  const candidate = {title: '<img src=x onerror=alert(1)>', url: 'https://www.emlakjet.com/ilan/example-123', snippet: 'Arama özeti', source: 'Emlakjet', asking_price: 3600000, area: 400, query: 'Yalova Hacımehmet satılık arsa', checked_at: '2026-11-27T10:00:00Z'};
  const successful = harness([
    {data: job('queued', 'waiting')},
    {data: job('running', 'running', {search_candidates: [candidate, {title: 'unsafe', url: 'javascript:alert(1)'}]})},
    {data: job('complete', 'complete', {search_candidates: [candidate]})}
  ]);
  const result = await successful.api.start(input);
  assert.equal(result.status, 'complete');
  assert(successful.element('agent-active').history.includes('1'), 'actual running state must be displayed');
  assert.equal(successful.element('agent-active').textContent, '0');
  assert(!successful.element('agent-active').history.includes('99'), 'count must derive from returned agent states, not an inconsistent claimed count');
  assert.equal(successful.calls.length, 3);
  assert(successful.calls.every(call => call.url.startsWith('/api/agent-runs')), 'no source URL may be fetched by the UI');
  assert.equal(successful.element('agent-search-count').textContent, '1');
  assert(text(successful.element('agent-search-list')).includes('Sayfa, aktiflik ve mesafe doğrulanmadı'));
  assert(text(successful.element('agent-search-list')).includes('<img src=x onerror=alert(1)>'), 'source text is displayed literally');
  assert.equal(successful.element('agent-search-list').children[0].children[0].tag, 'a');
  assert(successful.element('agent-ai').textContent.includes('etkin değil'));

  const unsupported = harness([{code: 404, data: {detail: 'Not Found'}}]);
  await assert.rejects(unsupported.api.start(input), error => error.code === 'unsupported');
  assert.equal(unsupported.calls.length, 1, 'unsupported job endpoint does not silently perform another analysis');
  const failure = harness([{code: 500, data: {detail: 'Sunucu hatası'}}]);
  await assert.rejects(failure.api.start(input), error => error.code !== 'unsupported' && error.message === 'Sunucu hatası');

  let release;
  const cancelled = harness([() => new Promise(resolve => { release = () => resolve({ok: true, status: 202, json: async () => job('running', 'running')}); })]);
  const pending = cancelled.api.start(input);
  cancelled.api.reset();
  release();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(cancelled.element('agent-panel').classList.hidden, true, 'late old-query response cannot reopen its dashboard');
  assert.equal(cancelled.element('agent-active').textContent, '—');
  console.log('PASS: syntax/IDs, real polling/counts, separate unverified search cards, safe text/URLs, no source fetch, explicit unsupported endpoint, no fallback on server error, and stale-query cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
