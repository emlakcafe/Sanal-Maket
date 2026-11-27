/* Regional asking-price evidence, separate from the verified 1 km valuation. */
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const amount = value => positive(value) ? value.toLocaleString('tr-TR', {maximumFractionDigits: 0}) : '—';
  const count = value => Number.isInteger(value) && value >= 0 ? value : 0;
  function node(tag, text, className) {
    const n = document.createElement(tag);
    n.textContent = text == null ? '' : String(text);
    if (className) n.className = className;
    return n;
  }
  function safeURL(value) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
          !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':') ||
          /(?:^|\.)(?:localhost|local|internal|lan|home|home\.arpa|test|invalid)$/.test(url.hostname) ||
          (url.port && !['80', '443'].includes(url.port))) return null;
      return url;
    } catch (_) { return null; }
  }
  function sourceLink(record) {
    const url = safeURL(record?.url);
    if (!url) return node('strong', record?.title || 'Kaynak bağlantısı doğrulanamadı');
    const a = node('a', record.title || url.hostname);
    a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }
  function dateText(value) {
    const date = value && new Date(value);
    return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('tr-TR') : null;
  }
  function statistic(label, value) {
    const row = node('div', '', 'regional-stat');
    row.append(node('dt', label), node('dd', value));
    return row;
  }
  function renderRecords(records, number) {
    const details = node('details', '', 'regional-evidence');
    details.append(node('summary', 'Analize giren ' + number + ' kaydı gör'));
    for (const record of (Array.isArray(records) ? records : [])) {
      const article = node('article', '', 'regional-record');
      article.append(sourceLink(record));
      const values = [];
      if (positive(record.asking_price)) values.push(amount(record.asking_price) + ' TL');
      if (positive(record.area)) values.push(record.area.toLocaleString('tr-TR', {maximumFractionDigits: 2}) + ' m²');
      if (positive(record.unit_price)) values.push(amount(record.unit_price) + ' TL/m²');
      if (values.length) article.append(node('p', values.join(' · '), 'regional-record-numbers'));
      const evidence = record.evidence === 'detail_page' ? 'İlan sayfasından okundu' : 'Arama kaydı; sayfa fiyatı yeniden doğrulanmadı';
      const observed = dateText(record.checked_at);
      const listed = dateText(record.listing_date);
      article.append(node('small', [record.source, evidence, listed ? 'İlan tarihi: ' + listed : null, observed ? 'Kontrol: ' + observed : null].filter(Boolean).join(' · ')));
      details.append(article);
    }
    return details;
  }
  function renderGroup(group, officialArea) {
    const card = node('article', '', 'regional-group');
    const title = group.kind === 'field' ? 'Tarla / tarımsal arazi' : 'Konut / villa imarlı arsa';
    card.append(node('h3', title), node('p', 'İlanlarda belirtilen niteliğe göre ayrı değerlendirildi.', 'note'));
    const samples = count(group.count);
    card.append(node('p', samples + ' ilan kaydı · ' + count(group.detail_count) + ' ilan sayfası · ' + count(group.index_count) + ' arama kaydı', 'regional-samples'));
    const validBand = group.status === 'available' && samples >= 3 &&
      [group.unit_q25, group.unit_median, group.unit_q75].every(positive) &&
      group.unit_q25 <= group.unit_median && group.unit_median <= group.unit_q75;
    if (validBand) {
      const band = node('div', '', 'regional-band');
      band.append(node('small', 'İlanların orta %50’sindeki m² fiyatı'),
        node('strong', amount(group.unit_q25) + ' – ' + amount(group.unit_q75)), node('span', 'TL/m²'));
      card.append(band);
      const stats = node('dl', '', 'regional-stats');
      stats.append(statistic('Medyan', amount(group.unit_median) + ' TL/m²'));
      if (positive(group.unit_min) && positive(group.unit_max) && group.unit_min <= group.unit_max) {
        stats.append(statistic('Gözlenen en düşük – en yüksek', amount(group.unit_min) + ' – ' + amount(group.unit_max) + ' TL/m²'));
      }
      card.append(stats);
      card.append(node('p', 'Ana aralık, örneklemin 25. ve 75. yüzdelikleri arasındadır; bütün ilanların en düşük ve en yüksek fiyatı değildir.', 'regional-method'));
      const hasTargetBand = officialArea && positive(group.subject_area) && Math.abs(group.subject_area - officialArea) < 0.01 &&
        positive(group.total_low) && positive(group.total_high) && group.total_low <= group.total_high;
      if (hasTargetBand) {
        const total = node('div', '', 'regional-total');
        const areaLabel = officialArea.toLocaleString('tr-TR', {maximumFractionDigits: 2}) + ' m²';
        const condition = group.conditional_zoning
          ? areaLabel + (group.kind === 'field' ? ' hedef parselin tarla olduğu varsayımıyla' : ' hedef parselin konut/villa imarlı olduğu varsayımıyla')
          : areaLabel + ' için, seçtiğiniz niteliğe göre';
        total.append(node('small', condition), node('strong', amount(group.total_low) + ' – ' + amount(group.total_high) + ' TL'), node('p', 'Bölgesel ilan fiyatı referansıdır; 1 km içi doğrulanmış değerleme veya gerçekleşmiş satış bedeli değildir.', 'note'));
        card.append(total);
      }
    } else {
      card.append(node('p', samples ? 'Bu grupta aralık hesaplamak için en az 3 uygun ilan kaydı gerekiyor.' : 'Bu grupta kullanılabilir fiyat ve alan bilgisi bulunamadı.', 'regional-empty'));
    }
    if (count(group.index_count) > 0 && count(group.detail_count) === 0) card.append(node('p', 'Bu grup yalnızca arama kayıtlarına dayanıyor; ilan sayfalarındaki güncel fiyatlar doğrulanmadı.', 'regional-caution'));
    for (const note of Array.isArray(group.notes) ? group.notes : []) card.append(node('p', note, 'note'));
    if (Array.isArray(group.records) && group.records.length) card.append(renderRecords(group.records, samples));
    return card;
  }
  function reset() {
    el('regional-analysis').classList.add('hidden');
    for (const id of ['regional-context', 'regional-status', 'regional-target-note', 'regional-groups', 'regional-notes', 'regional-exclusions']) el(id).replaceChildren();
  }
  function render(result) {
    reset();
    const analysis = result && result.regional_analysis;
    if (!analysis || typeof analysis !== 'object') return false;
    el('regional-analysis').classList.remove('hidden');
    const region = analysis.region || {};
    el('regional-context').textContent = [region.province, region.district, region.place].filter(Boolean).join(' / ') + ' · Mahalle/köy geneli';
    const groups = (Array.isArray(analysis.groups) ? analysis.groups : []).filter(g => g && ['residential', 'field'].includes(g.kind));
    const usable = groups.filter(g => g.status === 'available').length;
    el('regional-status').textContent = usable
      ? 'Bölgedeki ilanların talep fiyatları aşağıda karşılaştırıldı.'
      : 'Aralık hesaplamak için yeterli sayıda uygun ilan bulunamadı; bulunan kayıtlar ve eksikler aşağıda.';
    const subject = result.subject;
    const officialArea = subject && positive(subject.area) && /^TKGM\b/i.test(String(subject.source || '')) &&
      positive(analysis.subject_area) && Math.abs(analysis.subject_area - subject.area) < 0.01 ? subject.area : null;
    el('regional-target-note').textContent = officialArea
      ? 'Hedef alan: ' + officialArea.toLocaleString('tr-TR', {maximumFractionDigits: 2}) + ' m² (TKGM). Uygun gruplarda toplam fiyat referansı ayrıca gösterilir.'
      : 'TKGM’den hedef parsel alanı doğrulanamadığı için toplam parsel fiyatı hesaplanmadı. Bölgesel TL/m² analizi kullanılabilir.';
    for (const group of groups) el('regional-groups').append(renderGroup(group, officialArea));
    for (const note of Array.isArray(analysis.notes) ? analysis.notes : []) el('regional-notes').append(node('p', note, 'note'));
    const excluded = Array.isArray(analysis.excluded) ? analysis.excluded : [];
    if (excluded.length) {
      const details = node('details', '', 'regional-evidence');
      details.append(node('summary', 'Değerlendirme dışında kalan ' + excluded.length + ' kayıt'));
      for (const record of excluded) {
        const item = node('article', '', 'regional-record');
        item.append(sourceLink(record), node('p', record.reason || 'Karşılaştırma koşulları sağlanmadı.', 'note'));
        details.append(item);
      }
      el('regional-exclusions').append(details);
    }
    return true;
  }
  window.RegionalUI = {render, reset};
}());
