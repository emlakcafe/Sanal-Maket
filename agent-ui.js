/* Render and poll real server jobs. No simulated agent progress or source visits. */
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const terminal = new Set(['complete', 'partial', 'error']);
  const labels = {waiting: 'Bekliyor', queued: 'Sırada', running: 'Çalışıyor', complete: 'Tamamlandı', partial: 'Kısmen tamamlandı', blocked: 'Erişim sağlanamadı', error: 'Hata'};
  let generation = 0;
  let controller = null;
  let lastSnapshot = null;

  function textNode(tag, value, className) {
    const node = document.createElement(tag);
    node.textContent = value == null ? '' : String(value);
    if (className) node.className = className;
    return node;
  }
  function safeLink(value) {
    try {
      const u = new URL(value);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password ||
          !u.hostname.includes('.') || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':') ||
          /(?:^|\.)(?:localhost|local|internal|lan|home|home\.arpa|test|invalid)$/.test(u.hostname) ||
          (u.port && !['80', '443'].includes(u.port))) return null;
      return u;
    } catch (_) { return null; }
  }
  function dateLabel(value) {
    const date = value && new Date(value);
    return date && Number.isFinite(date.getTime()) ? date.toLocaleString('tr-TR') : null;
  }
  function renderCandidates(rows) {
    const list = el('agent-search-list');
    list.replaceChildren();
    const candidates = Array.isArray(rows) ? rows : [];
    let count = 0;
    for (const row of candidates.slice(0, 100)) {
      const url = safeLink(row?.url);
      if (!url) continue;
      count++;
      const card = document.createElement('article');
      const a = textNode('a', row.title || url.hostname);
      a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      card.append(a, textNode('p', row.snippet || 'Arama sonucunda açıklama bulunmuyor.', 'agent-snippet'));
      const money = Number.isFinite(row.asking_price) && row.asking_price > 0 ? row.asking_price.toLocaleString('tr-TR') + ' TL' : null;
      const area = Number.isFinite(row.area) && row.area > 0 ? row.area.toLocaleString('tr-TR') + ' m²' : null;
      if (money || area) card.append(textNode('p', 'Arama kaydındaki bilgi: ' + [money, area].filter(Boolean).join(' · '), 'agent-index-price'));
      card.append(textNode('small', (row.source || url.hostname) + ' · Arama kaydı · Sayfa, aktiflik ve mesafe doğrulanmadı.'));
      if (row.price_note) card.append(textNode('p', row.price_note, 'note'));
      const queries = [...new Set([row.query, ...(Array.isArray(row.queries) ? row.queries : [])].filter(q => typeof q === 'string' && q))];
      const observed = dateLabel(row.checked_at);
      if (queries.length || observed) {
        const details = document.createElement('details');
        details.append(textNode('summary', 'Arama kanıtı'));
        if (queries.length) details.append(textNode('p', queries.join('\n'), 'agent-query'));
        if (observed) details.append(textNode('p', 'Arama zamanı: ' + observed, 'note'));
        card.append(details);
      }
      list.append(card);
    }
    el('agent-search-count').textContent = String(count);
    el('agent-search-section').classList.toggle('hidden', count === 0);
  }
  function renderSnapshot(snapshot) {
    lastSnapshot = snapshot;
    const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
    const running = agents.filter(a => a.status === 'running').length;
    const done = agents.filter(a => a.status === 'complete').length;
    const waiting = agents.filter(a => a.status === 'waiting' || a.status === 'queued').length;
    el('agent-panel').classList.remove('hidden');
    el('agent-active').textContent = String(running);
    el('agent-total').textContent = String(agents.length);
    el('agent-summary').textContent = (labels[snapshot.status] || 'Durum alınıyor') + ' · ' + done + ' tamamlandı · ' + waiting + ' bekliyor';
    el('agent-connection').textContent = 'Son sunucu yanıtı: ' + new Date().toLocaleTimeString('tr-TR');
    const ai = snapshot.ai || {};
    el('agent-ai').textContent = ai.running === true
      ? 'Google yapay zekâ araştırması: sunucu çalıştığını bildiriyor.'
      : ai.configured === true
        ? 'Google yapay zekâ bağlantısı hazır; bu görevde otomatik Google çağrısı çalışmıyor.'
        : 'Google yapay zekâ bağlantısı etkin değil. Aşağıdaki görevler web araması, sayfa okuma ve hesaplama otomasyonudur.';
    const list = el('agent-list');
    list.replaceChildren();
    for (const agent of agents) {
      const item = document.createElement('li');
      item.className = 'agent-card';
      const state = Object.prototype.hasOwnProperty.call(labels, agent.status) ? agent.status : 'unknown';
      item.dataset.state = state;
      const head = textNode('div', '', 'agent-card-head');
      head.append(textNode('strong', agent.name || agent.id || 'Görev'), textNode('span', labels[state] || 'Durum bilinmiyor', 'agent-state'));
      item.append(head);
      if (agent.message) item.append(textNode('p', agent.message, 'agent-message'));
      if (agent.engine === 'google_ai') item.append(textNode('small', 'Yapay zekâ araştırması'));
      else item.append(textNode('small', 'Otomatik araç ve kural görevi'));
      list.append(item);
    }
    renderCandidates(snapshot.search_candidates);
    if (snapshot.error) el('agent-connection').textContent = String(snapshot.error);
  }
  function reset() {
    generation++;
    if (controller) controller.abort();
    controller = null;
    lastSnapshot = null;
    el('agent-panel').classList.add('hidden');
    el('agent-list').replaceChildren();
    el('agent-active').textContent = '—';
    el('agent-total').textContent = '—';
    el('agent-summary').textContent = '';
    el('agent-connection').textContent = '';
    renderCandidates([]);
  }
  function legacy(message) {
    el('agent-panel').classList.remove('hidden');
    el('agent-active').textContent = '—';
    el('agent-total').textContent = '—';
    el('agent-list').replaceChildren();
    el('agent-summary').textContent = 'Ajan iş servisi bu sürümde desteklenmiyor.';
    el('agent-connection').textContent = message;
    el('agent-ai').textContent = 'Eski parsel ve kaynak okuyucu akışı çalıştırılıyor. Canlı ajan durumu alınamıyor.';
  }
  function abortError() { const error = new Error('İş takibi durduruldu.'); error.name = 'AbortError'; return error; }
  async function request(path, options, signal, allowUnsupported) {
    const local = new AbortController();
    const abort = () => local.abort();
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) local.abort();
    const timer = setTimeout(() => local.abort(), 20000);
    try {
      const response = await fetch(path, {...options, cache: 'no-store', signal: local.signal});
      if (allowUnsupported && [404, 405].includes(response.status)) {
        const error = new Error('Ajan iş servisi bu sürümde bulunamadı.'); error.code = 'unsupported'; throw error;
      }
      let data;
      try { data = await response.json(); } catch (_) { throw new Error('Ajan servisinden okunabilir yanıt alınamadı.'); }
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Ajan hizmeti isteği tamamlayamadı (HTTP ' + response.status + ').');
      return data;
    } catch (error) {
      if (local.signal.aborted && !signal.aborted) throw new Error('Ajan servisinin yanıtı zaman aşımına uğradı.');
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(abortError()); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) abort();
    });
  }
  async function start(input) {
    reset();
    const turn = generation;
    const taskController = new AbortController();
    controller = taskController;
    const signal = taskController.signal;
    el('agent-panel').classList.remove('hidden');
    el('agent-summary').textContent = 'Araştırma işi sunucuda başlatılıyor…';
    el('agent-connection').textContent = 'İlk gerçek görev durumu bekleniyor.';
    el('agent-ai').textContent = '';
    try {
      let snapshot = await request('/api/agent-runs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)}, signal, true);
      if (turn !== generation || signal.aborted) throw abortError();
      if (!snapshot || typeof snapshot.job_id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(snapshot.job_id)) throw new Error('Sunucu geçerli bir araştırma iş kimliği döndürmedi.');
      const jobId = snapshot.job_id;
      const deadline = Date.now() + 240000;
      let failures = 0;
      renderSnapshot(snapshot);
      while (true) {
        if (turn !== generation || signal.aborted) throw abortError();
        if (terminal.has(snapshot.status)) {
          if (!snapshot.result) throw new Error(snapshot.error || 'Görev tamamlandı ancak kullanılabilir parsel raporu alınamadı.');
          return snapshot;
        }
        if (Date.now() > deadline) throw new Error('Sunucudaki işin sonucu süre sınırında alınamadı. Görevlerin son bildirilen durumu yukarıda; tamamlandığı doğrulanmadı.');
        await wait(Math.max(500, Math.min(5000, Number(snapshot.poll_after_ms) || 900)), signal);
        try {
          const next = await request('/api/agent-runs/' + encodeURIComponent(jobId), {method: 'GET'}, signal, false);
          if (turn !== generation || signal.aborted) throw abortError();
          if (!next || next.job_id !== jobId) throw new Error('Sunucunun döndürdüğü iş kimliği eşleşmedi.');
          snapshot = next;
          failures = 0;
          renderSnapshot(snapshot);
        } catch (error) {
          if (signal.aborted || turn !== generation) throw abortError();
          failures++;
          el('agent-connection').textContent = 'Yeni durum alınamadı; gösterilen sayılar son sunucu yanıtına aittir. ' + error.message;
          if (failures >= 3) throw error;
          // No changes to agent state until a new real server response arrives.
          await wait(1500, signal);
        }
      }
    } catch (error) {
      if (turn === generation && error.name !== 'AbortError') {
        el('agent-connection').textContent = error.message;
        if (!lastSnapshot) el('agent-summary').textContent = 'Ajan işi başlatılamadı.';
      }
      throw error;
    } finally {
      if (turn === generation) controller = null;
    }
  }
  window.addEventListener('pagehide', reset);
  window.AgentUI = {start, reset, legacy};
}());
