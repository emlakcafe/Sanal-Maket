/* Google report after a requested parcel analysis. No listing ingestion or browser storage. */
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  let selection = null;
  let configured = false;
  let checking = true;
  let running = false;
  let generation = 0;
  let controller = null;
  let completed = null;
  let autoStarted = false;
  const identity = req => req && JSON.stringify(['province', 'district', 'place', 'place_kind', 'block', 'parcel', 'zoning']
    .map(key => String(req[key] || '').trim()));
  const validSelection = req => !!(req && req.province && req.district && req.place &&
    /^\d{1,9}$/.test(req.block) && /^[1-9]\d{0,8}$/.test(req.parcel));
  const codeReady = () => el('research-code').value.length >= 24;
  const idleMessage = () => checking
    ? 'Google araştırma bağlantısı kontrol ediliyor…'
    : !completed
      ? 'Önce parseli bulun; TKGM sonucu araştırmaya otomatik aktarılacak.'
      : configured
        ? codeReady()
          ? 'TKGM sonucu hazır. Kaynaklı Google araştırması başlatılabilir.'
          : 'TKGM sonucu hazır. Uygulama içinde rapor almak için araştırma erişim kodunuzu girin.'
        : 'TKGM bilgileri Google araması için hazırlandı. Aşağıdaki bağlantı Google’ı yeni sekmede açar; sonuç bu ekrana otomatik aktarılmaz. Uygulama içi Google raporu bağlantısı henüz etkin değil.';
  function currentSelection() {
    try { return selection && selection(); } catch (_) { return null; }
  }
  function refresh() {
    const req = currentSelection();
    const ready = validSelection(req) && completed && completed.key === identity(req);
    el('research-go').disabled = !configured || running || !ready || !!completed?.expired || !codeReady();
    el('research-go').textContent = running ? 'Google araştırması sürüyor…' : 'Google raporunu yeniden hazırla';
    el('research-go').classList.toggle('hidden', !configured);
    el('research-access').classList.toggle('hidden', !configured);
    el('research-open').classList.toggle('hidden', !ready);
    el('research-external-note').classList.toggle('hidden', !ready);
    if (ready) {
      const url = new URL('https://www.google.com/search');
      url.searchParams.set('hl', 'tr');
      url.searchParams.set('q', searchPrompt(completed));
      el('research-open').href = url.href;
    } else {
      el('research-open').removeAttribute('href');
    }
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
    completed = null;
    autoStarted = false;
    clearResult();
    el('research-context').textContent = '';
    el('research-status').textContent = idleMessage();
    refresh();
  }
  function searchPrompt(context) {
    const req = context.request;
    const subject = context.subject;
    const lines = [req.province + ', ' + req.district + ', ' + req.place + ', ' + req.block + ' ada ' + req.parcel + ' parsel için emsal satılık ilanları ve fiyat analizi araştır.'];
    if (subject) {
      if (Number.isFinite(subject.area) && subject.area > 0) lines.push('TKGM alanı: ' + subject.area + ' m².');
      if (subject.nature) lines.push('TKGM tapu niteliği: ' + subject.nature + '.');
      if (Array.isArray(subject.center) && subject.center.length === 2 && subject.center.every(Number.isFinite) && Math.abs(subject.center[0]) <= 90 && Math.abs(subject.center[1]) <= 180) {
        lines.push('TKGM parsel merkezi (enlem, boylam): ' + subject.center.map(n => n.toFixed(6)).join(', ') + '.');
      }
    } else {
      lines.push('Bu sorguda kesin TKGM alanı ve konumu doğrulanamadı; eksik bilgileri varsayma.');
    }
    const zoning = {residential: 'Kullanıcı konut/villa imarlı seçti; resmî imar belgesi doğrulanmadı.', field: 'Kullanıcı tarla/tarımsal arazi seçti.', unknown: 'İmar durumu bilinmiyor; tapu niteliğinden imar hakkı çıkarma.'};
    lines.push(zoning[req.zoning] || zoning.unknown);
    lines.push('Önce 1 km çevresindeki benzer satılık ilanları ara. Sahibinden, Hepsiemlak, Emlakjet ve diğer erişilebilir kaynakları değerlendir.');
    lines.push('Her örnek için kaynak bağlantısı, fiyat, m², TL/m² ve varsa ada/parsel belirt. Konumu veya aktifliği doğrulanmayanı açıkça işaretle; 1 km dışında ya da mesafesi belirsiz olanları bölgesel aday olarak ayır.');
    lines.push('Arsa ve tarlayı aynı fiyat grubuna koyma. Uygun emsallerle gerekçeli alt ve üst fiyat aralığı ver; veri yetmiyorsa belirt. Bunlar gerçekleşen satış fiyatları değil ilan talep fiyatlarıdır. Deniz manzarası, imar, pazarlık oranı veya kesin mesafe uydurma.');
    return lines.join(' ');
  }
  function maybeAutoRun() {
    if (completed && completed.key === identity(currentSelection()) && configured && codeReady() && !autoStarted && !running) {
      autoStarted = true;
      void run();
    }
  }
  function afterAnalyze(result, analyzedRequest) {
    const req = currentSelection();
    const expected = analyzedRequest || req;
    if (!validSelection(req) || identity(expected) !== identity(req)) return;
    if (completed && completed.key === identity(req) && completed.analysis_ref === result) return;
    let subject = result && result.subject;
    if (subject && (String(subject.block) !== String(req.block) || String(subject.parcel) !== String(req.parcel))) subject = null;
    completed = {
      key: identity(req), request: {...req}, subject: subject || null, analysis_ref: result,
      context_id: typeof result?.research_context_id === 'string' ? result.research_context_id : null
    };
    autoStarted = false;
    el('research-context').textContent = req.province + ' / ' + req.district + ' / ' + req.place + ' · ' + req.block + '/' + req.parcel +
      (subject && Number.isFinite(subject.area) && subject.area > 0 ? ' · ' + subject.area.toLocaleString('tr-TR') + ' m²' : ' · TKGM alanı doğrulanmadı') +
      (subject?.nature ? ' · ' + subject.nature : '');
    el('research-status').textContent = idleMessage();
    refresh();
    maybeAutoRun();
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
    refresh();
    if (!completed || el('research-go').disabled) return;
    const request = {...completed.request};
    if (completed.context_id) request.context_id = completed.context_id;
    autoStarted = true;
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
        if (result.status === 'invalid_context' && completed) completed.expired = true;
        const messages = {
          not_configured: 'Google araştırma bağlantısı henüz etkinleştirilmedi.',
          unauthorized: 'Araştırma erişim kodunu kontrol edin.',
          invalid_context: 'Parsel bilgisi değişti veya araştırma süresi doldu. Parseli yeniden sorgulayın.',
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
    el('research-code').onchange = maybeAutoRun;
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
    maybeAutoRun();
  }
  window.addEventListener('pagehide', () => { reset(); el('research-code').value = ''; });
  window.GoogleResearch = {init, refresh, reset, afterAnalyze};
}());
