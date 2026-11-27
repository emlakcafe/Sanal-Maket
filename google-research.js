/* Optional user-triggered Google report. No listing ingestion or browser storage. */
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  let selection = null;
  let configured = false;
  let checking = true;
  let running = false;
  let generation = 0;
  let controller = null;
  const idleMessage = () => checking
    ? 'Google araştırma bağlantısı kontrol ediliyor…'
    : configured
      ? 'Seçtiğiniz parsel için kaynaklı bölge raporu hazırlayın.'
      : 'Google araştırma bağlantısı henüz etkinleştirilmedi. Parsel ve 1 km emsal sorgusu kullanılabilir.';
  function currentSelection() {
    try { return selection && selection(); } catch (_) { return null; }
  }
  function refresh() {
    const req = currentSelection();
    const valid = req && req.province && req.district && req.place &&
      /^\d{1,9}$/.test(req.block) && /^[1-9]\d{0,8}$/.test(req.parcel);
    el('research-go').disabled = !configured || running || !valid || el('research-code').value.length < 24;
  }
  function clearResult() {
    el('research-report').classList.add('hidden');
    el('research-answer').replaceChildren();
    el('research-links').replaceChildren();
    el('research-suggestions').replaceChildren();
    el('research-time').textContent = '';
  }
  function reset() {
    generation++;
    if (controller) controller.abort();
    controller = null;
    running = false;
    clearResult();
    el('research-status').textContent = idleMessage();
    refresh();
  }
  function safeURL(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.username || u.password ||
          u.hostname === 'localhost' || !u.hostname.includes('.') ||
          /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) return null;
      return u.href;
    } catch (_) { return null; }
  }
  function sourceLink(source, label) {
    const href = safeURL(source.url);
    if (!href) return null;
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label;
    return a;
  }
  function renderReport(result) {
    clearResult();
    const sources = new Map((result.sources || []).map(s => [s.index, s]));
    const answer = el('research-answer');
    const fragments = result.fragments || [];
    if (fragments.map(f => f.text).join('') === result.text) {
      for (const fragment of fragments) {
        answer.append(document.createTextNode(fragment.text));
        for (const index of fragment.citation_indices || []) {
          const source = sources.get(index);
          const a = source && sourceLink(source, '[' + (index + 1) + ']');
          if (a) {
            a.className = 'research-citation';
            a.setAttribute('aria-label', (index + 1) + '. kaynak: ' + source.title);
            answer.append(a);
          }
        }
      }
    } else {
      answer.textContent = result.text || '';
    }
    for (const source of sources.values()) {
      const a = sourceLink(source, '[' + (source.index + 1) + '] ' + source.title);
      if (a) { const p = document.createElement('p'); p.append(a); el('research-links').append(p); }
    }
    // Provider HTML/CSS stays intact in a separate opaque-origin frame. It cannot
    // execute scripts or reach the application DOM, credentials or storage.
    if (result.search_suggestions_html) {
      const frame = document.createElement('iframe');
      frame.title = 'Google arama önerileri';
      frame.className = 'research-suggestions-frame';
      frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
      frame.referrerPolicy = 'no-referrer';
      const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data: https://www.google.com https://*.gstatic.com; font-src https://fonts.gstatic.com; form-action 'none'; base-uri 'none'";
      frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' + result.search_suggestions_html;
      el('research-suggestions').append(frame);
    }
    el('research-time').textContent = 'Google Arama destekli Gemini yanıtı · ' +
      new Date(result.checked_at).toLocaleString('tr-TR');
    el('research-report').classList.remove('hidden');
  }
  async function run() {
    const request = currentSelection();
    refresh();
    if (!request || el('research-go').disabled) return;
    const turn = ++generation;
    const thisController = new AbortController();
    controller = thisController;
    running = true;
    clearResult();
    refresh();
    el('research-status').textContent = 'Parsel bilgisi kontrol ediliyor; Google destekli bölge araştırması hazırlanıyor…';
    const timer = setTimeout(() => thisController.abort(), 70000);
    try {
      const response = await fetch('/api/research', {
        method: 'POST', cache: 'no-store', signal: thisController.signal,
        headers: {'Content-Type': 'application/json', 'X-Research-Code': el('research-code').value},
        body: JSON.stringify(request)
      });
      const result = await response.json();
      if (turn !== generation) return;
      if (!response.ok) throw new Error('Araştırma hizmeti yanıt veremedi.');
      if (result.status === 'ok') {
        renderReport(result);
        el('research-status').textContent = 'Kaynaklı Google araştırması tamamlandı.';
      } else {
        const messages = {
          not_configured: 'Google araştırma bağlantısı henüz etkinleştirilmedi.',
          unauthorized: 'Araştırma erişim kodunu kontrol edin.',
          busy: 'Başka bir araştırma sürüyor. Tamamlandıktan sonra yeniden deneyin.',
          quota_exceeded: 'Bu test oturumunun günlük araştırma sınırına ulaşıldı.',
          rate_limited: 'Google sorgu kotası veya hız sınırına ulaşıldı.',
          timeout: 'Google araştırması süre sınırında tamamlanamadı.',
          no_grounding: 'Google bu sorgu için gösterilebilir kaynaklı bir yanıt döndürmedi.',
          provider_error: 'Google bağlantısı yanıt veremedi. Bağlantı ayarlarının kontrol edilmesi gerekiyor.'
        };
        el('research-status').textContent = messages[result.status] || 'Araştırma tamamlanamadı.';
      }
    } catch (error) {
      if (turn === generation) el('research-status').textContent = error.name === 'AbortError'
        ? 'Araştırma süre sınırında tamamlanamadı.' : 'Araştırma bağlantısı kurulamadı.';
    } finally {
      clearTimeout(timer);
      if (turn === generation) { running = false; controller = null; refresh(); }
    }
  }
  async function init(getSelection) {
    selection = getSelection;
    el('research-go').onclick = run;
    el('research-code').oninput = refresh;
    reset();
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 10000);
      try {
        const response = await fetch('/api/research/status', {cache: 'no-store', signal: c.signal});
        if (response.ok) configured = (await response.json()).configured === true;
      } finally { clearTimeout(t); }
    } catch (_) { configured = false; }
    checking = false;
    el('research-access').classList.toggle('hidden', !configured);
    el('research-status').textContent = idleMessage();
    refresh();
  }
  window.addEventListener('pagehide', () => { reset(); el('research-code').value = ''; });
  window.GoogleResearch = {init, refresh, reset};
}());
