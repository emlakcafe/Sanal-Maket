/* Offline checks: node tests/test_regional_ui.js */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'regional-ui.js'), 'utf8');
new vm.Script(source);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(html.indexOf('id="regional-analysis"') < html.indexOf('id="result"'));
assert(html.indexOf('id="result"') < html.indexOf('id="agent-search-section"'));
assert(html.includes('1 km filtresi uygulanmadı'));
assert(html.includes('İsteğe bağlı Google araştırması'));
const elements = new Map();
function node(tag = 'div') {
  return {tag, textContent: '', className: '', children: [],
    classList: {add(key) { this[key] = true; }, remove(key) { this[key] = false; }},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; this.textContent = ''; }};
}
const el = id => {
  if (!elements.has(id)) elements.set(id, node());
  return elements.get(id);
};
const window = {};
vm.runInNewContext(source, {window, document: {getElementById: el, createElement: node}, URL, Date, console});
function text(n) { return n.textContent + ' ' + n.children.map(text).join(' '); }
function find(n, predicate) { return [n, ...n.children.flatMap(child => find(child, predicate))].filter(predicate); }
const record = {title: '<img src=x onerror=alert(1)>', url: 'https://www.emlakjet.com/ilan/example-123', source: 'Emlakjet', asking_price: 3200000, area: 400, unit_price: 8000, evidence: 'detail_page', checked_at: '2026-11-27T11:30:00Z'};
const group = {kind: 'residential', status: 'available', count: 4, detail_count: 2, index_count: 2,
  unit_q25: 8000, unit_median: 9000, unit_q75: 10000, unit_min: 6500, unit_max: 12500,
  subject_area: 381, total_low: 3048000, total_high: 3810000, conditional_zoning: true, records: [record], notes: []};
const analysis = {status: 'available', region: {province: 'Yalova', district: 'Termal', place: 'Akköy'}, subject_area: 381, groups: [group], notes: [], excluded: []};

assert.equal(window.RegionalUI.render({subject: null, regional_analysis: analysis}), true);
assert(text(el('regional-groups')).includes('8.000 – 10.000'));
assert(text(el('regional-groups')).includes('6.500 – 12.500'));
assert.equal(find(el('regional-groups'), n => n.className === 'regional-total').length, 0, 'a remembered area must not create a total when current TKGM subject is absent');
assert(el('regional-target-note').textContent.includes('toplam parsel fiyatı hesaplanmadı'));
assert(text(el('regional-groups')).includes('2 ilan sayfası · 2 arama kaydı'));
assert.equal(find(el('regional-groups'), n => n.tag === 'img').length, 0);
assert(text(el('regional-groups')).includes('<img src=x onerror=alert(1)>'));
assert(find(el('regional-groups'), n => n.tag === 'details').every(n => n.open !== true));

window.RegionalUI.render({subject: {area: 381, source: 'TKGM MEGSİS'}, regional_analysis: analysis});
const totals = find(el('regional-groups'), n => n.className === 'regional-total');
assert.equal(totals.length, 1);
assert(text(totals[0]).includes('varsayımıyla'));
assert(text(totals[0]).includes('3.048.000 – 3.810.000 TL'));

window.RegionalUI.render({subject: {area: 381, source: 'Kullanıcı beyanı'}, regional_analysis: analysis});
assert.equal(find(el('regional-groups'), n => n.className === 'regional-total').length, 0, 'manual area is not official TKGM evidence');

window.RegionalUI.render({subject: null, regional_analysis: {...analysis, subject_area: null, groups: [group, {...group, kind: 'field', detail_count: 0, index_count: 4, unit_q25: 3000, unit_median: 4000, unit_q75: 5000, unit_min: 2000, unit_max: 6000}]}});
assert.equal(find(el('regional-groups'), n => n.className === 'regional-group').length, 2);
assert(text(el('regional-groups')).includes('Tarla / tarımsal arazi'));
assert(text(el('regional-groups')).includes('yalnızca arama kayıtlarına dayanıyor'));

window.RegionalUI.render({subject: null, regional_analysis: {...analysis, groups: [{...group, status: 'insufficient', count: 2}], excluded: [{title: 'Bina ilanı', url: 'javascript:alert(1)', reason: 'Arsa kategorisine uymuyor.'}]}});
assert.equal(find(el('regional-groups'), n => n.className === 'regional-band').length, 0, 'small samples must not display a calculated band');
assert(text(el('regional-groups')).includes('en az 3'));
assert.equal(find(el('regional-exclusions'), n => n.tag === 'a').length, 0);
assert(text(el('regional-exclusions')).includes('Arsa kategorisine uymuyor.'));
window.RegionalUI.reset();
assert.equal(el('regional-analysis').classList.hidden, true);
assert.equal(el('regional-groups').children.length, 0);
console.log('PASS: regional results precede map, unit-only analysis without current TKGM area, conditional total with exact area, separate land groups, evidence counts, small-sample suppression, safe source text/URLs, and stale-result reset.');
