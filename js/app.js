import { t, getLang, setLang, applyStaticI18n, labelOf } from './i18n.js';
import { initDitherBackground } from './dither-bg.js';
import { mountTearTicket } from './tear-ticket.js';

const state = {
  data: null,
  vehicleSpecs: null,
  lang: getLang(),
  trackId: 'nordschleife',
  /** vehicle class key (executive-cars…); null = all classes. Powertrain is a separate filter. */
  classKey: null,
  brand: '',
  year: '',
  powertrain: '',
  q: '',
  selected: new Set(),
  activeId: null,
  sourceMode: 'api', // api | static
  pollTimer: null,
};

const $ = (sel) => document.querySelector(sel);

// ---------- data ----------

async function loadData({ silent = false } = {}) {
  if (!silent) {
    $('#loading').hidden = false;
    $('#empty').hidden = true;
  }
  try {
    let payload = null;
    try {
      const res = await fetch('/api/published', { cache: 'no-store' });
      if (res.ok) {
        payload = await res.json();
        state.sourceMode = 'api';
      }
    } catch {
      /* fall through to static */
    }
    if (!payload) {
      const res = await fetch('./data/published.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('published.json missing');
      payload = await res.json();
      state.sourceMode = 'static';
    }
    state.data = payload;
    renderAll();
    renderNotice();
    renderSyncPill();
  } catch (err) {
    showNotice(t('notice.fail'), true);
    console.error(err);
  } finally {
    $('#loading').hidden = true;
  }
}

async function pollVersion() {
  // Server mode: /api/sync/status
  try {
    const res = await fetch('/api/sync/status', { cache: 'no-store' });
    if (res.ok) {
      const status = await res.json();
      renderSyncFromStatus(status);
      const remote = status.data_version;
      const local = state.data?.meta?.data_version;
      if (remote && remote !== local) {
        await loadData({ silent: true });
      }
      return;
    }
  } catch {
    /* fall through to static poll */
  }

  // Static mode (GitHub Pages): published.json is refreshed by Actions
  try {
    const res = await fetch('./data/published.json', { cache: 'no-store' });
    if (!res.ok) return;
    const payload = await res.json();
    const remote = payload?.meta?.data_version;
    const local = state.data?.meta?.data_version;
    if (remote && remote !== local) {
      state.data = payload;
      state.sourceMode = 'static';
      renderAll();
      renderNotice();
      renderSyncPill();
    }
  } catch {
    /* ignore */
  }
}

// ---------- derive ----------

function allRecords() {
  return state.data?.records || [];
}

function categoriesForTrack(trackId) {
  return (state.data?.categories || []).filter((c) => c.track_id === trackId);
}

function classKeyOf(catId) {
  return String(catId).split('/')[2] || '';
}

function powertrainOfCategory(catId) {
  const part = String(catId).split('/')[1] || '';
  if (part === 'combustion' || part === 'electric' || part === 'prototypes' || part === 'open') {
    return part === 'open' ? '' : part;
  }
  return '';
}

function classLabel(key) {
  const k = `class.${key}`;
  const translated = t(k);
  return translated !== k ? translated : key;
}

/** Display classes present on the current track (merged across powertrain). */
function displayClassesForTrack(trackId) {
  const map = new Map();
  for (const r of allRecords().filter((x) => x.track_id === trackId)) {
    const key = classKeyOf(r.category_id);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, count: 0, official: new Set() });
    const entry = map.get(key);
    entry.count += 1;
    entry.official.add(r.category_id);
  }
  const order = [
    'prototypes',
    'compact-cars',
    'mid-range-cars',
    'executive-cars',
    'suvs',
    'sports-cars',
    'super-sports-cars',
    'modified-vehicles',
    'autonomous-driving',
  ];
  return [...map.values()].sort(
    (a, b) =>
      (order.indexOf(a.key) === -1 ? 99 : order.indexOf(a.key)) -
      (order.indexOf(b.key) === -1 ? 99 : order.indexOf(b.key)),
  );
}

function filteredRecords() {
  let rows = allRecords().filter((r) => r.track_id === state.trackId);

  // 车型分类：不拆燃油/纯电，动力形式只在筛选里生效
  if (state.classKey) {
    rows = rows.filter((r) => classKeyOf(r.category_id) === state.classKey);
  }
  if (state.powertrain) {
    rows = rows.filter((r) => powertrainOfCategory(r.category_id) === state.powertrain);
  }
  if (state.brand) {
    rows = rows.filter((r) => r.brand === state.brand);
  }
  if (state.year) {
    rows = rows.filter((r) => String(r.record_date).startsWith(state.year));
  }
  if (state.q) {
    const n = state.q.toLowerCase();
    rows = rows.filter(
      (r) =>
        String(r.vehicle_en).toLowerCase().includes(n) ||
        String(r.driver_en || '').toLowerCase().includes(n) ||
        String(r.brand).toLowerCase().includes(n),
    );
  }

  // Sort by integer milliseconds — never mix timing regimes (already isolated by track).
  rows = [...rows].sort((a, b) => a.lap_time_ms - b.lap_time_ms || a.record_date.localeCompare(b.record_date));
  return rows;
}

function catById(catId) {
  return (state.data?.categories || []).find((c) => c.id === catId) || null;
}

function catLabel(catId) {
  const cat = catById(catId);
  if (!cat) return catId;
  return labelOf(cat, 'name');
}

/** Official category as data (tooltip/detail) — not used to split the nav tree. */
function catLabelQualified(catId) {
  const cat = catById(catId);
  if (!cat) return catId;
  const groupKey = String(cat.id).split('/')[1] || '';
  const short =
    t(`group.${groupKey}`) !== `group.${groupKey}`
      ? t(`group.${groupKey}`)
      : getLang() === 'zh'
        ? cat.group_zh
        : cat.group_en;
  return `${short}｜${labelOf(cat, 'name')}`;
}

function isSiteSummaryView(rows) {
  if (!state.classKey && !state.powertrain) return true;
  const cats = new Set(rows.map((r) => r.category_id));
  return cats.size > 1;
}

function trackLabel(trackId) {
  const tr = (state.data?.tracks || []).find((t) => t.id === trackId);
  return tr ? labelOf(tr, 'name') : trackId;
}

function trackMeta(trackId) {
  return (state.data?.tracks || []).find((t) => t.id === trackId);
}

// ---------- render ----------

function renderAll() {
  renderTracks();
  renderCategoryTree();
  renderFilterOptions();
  renderBoard();
  renderNews();
  renderHeroStats();
  if (state.activeId) renderDetail(state.activeId);
}

function renderHeroStats() {
  const rec = document.getElementById('stat-records');
  const cls = document.getElementById('stat-classes');
  const syncEl = document.getElementById('stat-sync');
  const syncTime = document.getElementById('stat-sync-time');
  if (rec) rec.textContent = String(allRecords().length);
  const classCount = new Set(allRecords().map((r) => classKeyOf(r.category_id))).size;
  if (cls) cls.textContent = String(classCount);
  const meta = state.data?.meta || {};
  if (syncEl) {
    if (state.sourceMode === 'static') syncEl.textContent = t('notice.static').slice(0, 18) + '…';
    else if (meta.last_status === 'failed') syncEl.textContent = t('sync.fail');
    else if (meta.is_stale) syncEl.textContent = t('sync.stale');
    else syncEl.textContent = t('sync.ok');
  }
  if (syncTime) {
    const ts = meta.last_success_at || meta.last_check_at;
    syncTime.textContent = ts ? String(ts).replace('T', ' ').slice(0, 16) + 'Z' : t('sync.never');
  }
}

function renderTracks() {
  const wrap = $('#track-tabs');
  wrap.innerHTML = '';
  const tracks = state.data?.tracks || [];
  for (const tr of tracks) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'track-tab';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(tr.id === state.trackId));
    btn.innerHTML = `<span></span><small></small>`;
    btn.children[0].textContent = labelOf(tr, 'name');
    btn.children[1].textContent = `${tr.distance_km} km · ${tr.timing_key}`;
    btn.addEventListener('click', () => {
      state.trackId = tr.id;
      state.classKey = null;
      state.selected.clear();
      renderAll();
    });
    wrap.appendChild(btn);
  }
}

function selectClass(classKey) {
  state.classKey = classKey;
  renderAll();
}

function renderCategoryTree() {
  const nav = $('#category-tree');
  nav.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `cat-item${state.classKey === null ? ' is-active' : ''}`;
  allBtn.textContent = t('ui.allCategories');
  allBtn.addEventListener('click', () => selectClass(null));
  nav.appendChild(allBtn);

  const head = document.createElement('div');
  head.className = 'cat-group';
  head.textContent = t('filter.categories');
  nav.appendChild(head);

  for (const entry of displayClassesForTrack(state.trackId)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cat-item${state.classKey === entry.key ? ' is-active' : ''}`;
    btn.dataset.classKey = entry.key;

    const main = document.createElement('span');
    main.textContent = classLabel(entry.key);

    const off = document.createElement('span');
    off.className = 'cat-official';
    // count reflects current powertrain filter so users see what's inside
    const count = filteredRecords().filter((r) => classKeyOf(r.category_id) === entry.key).length;
    off.textContent = `${entry.count} ${t('ui.records')}${count !== entry.count ? ` · ${count}` : ''}`;

    btn.append(main, off);
    btn.title = `${classLabel(entry.key)} (${entry.key})`;
    btn.addEventListener('click', () => selectClass(entry.key));
    nav.appendChild(btn);
  }
}

function renderFilterOptions() {
  const brands = [...new Set(allRecords().filter((r) => r.track_id === state.trackId).map((r) => r.brand))].sort();
  const years = [...new Set(allRecords().map((r) => String(r.record_date).slice(0, 4)))].sort().reverse();

  const brandSel = $('#filter-brand');
  const yearSel = $('#filter-year');
  const prevBrand = state.brand;
  const prevYear = state.year;

  brandSel.innerHTML = '';
  const b0 = document.createElement('option');
  b0.value = '';
  b0.textContent = t('filter.all');
  brandSel.appendChild(b0);
  for (const b of brands) {
    const o = document.createElement('option');
    o.value = b;
    o.textContent = b;
    brandSel.appendChild(o);
  }
  brandSel.value = prevBrand;

  yearSel.innerHTML = '';
  const y0 = document.createElement('option');
  y0.value = '';
  y0.textContent = t('filter.all');
  yearSel.appendChild(y0);
  for (const y of years) {
    const o = document.createElement('option');
    o.value = y;
    o.textContent = y;
    yearSel.appendChild(o);
  }
  yearSel.value = prevYear;
}

function missing() {
  return getLang() === 'zh' ? '暂无资料' : 'No data';
}

function renderBoard() {
  const rows = filteredRecords();
  const tbody = $('#board-body');
  tbody.innerHTML = '';

  const title = $('#board-title');
  const meta = $('#board-meta');
  const badge = $('#summarize-badge');
  const siteSummary = isSiteSummaryView(rows);

  if (state.classKey) {
    title.textContent = classLabel(state.classKey);
  } else {
    title.textContent = t('ui.allCategories');
  }
  meta.textContent = `${trackLabel(state.trackId)} · ${t('ui.inCategory')} · ${rows.length} ${t('ui.records')}`;
  badge.hidden = !siteSummary;

  $('#empty').hidden = rows.length > 0;
  $('#board').hidden = rows.length === 0;

  // P1 accent only when the view maps to one official category
  const officialCategoryView = !siteSummary;

  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;
    if (r.id === state.activeId) tr.classList.add('is-active');
    if (state.selected.has(r.id)) tr.classList.add('is-selected');
    if (officialCategoryView && idx === 0) tr.classList.add('is-p1');

    const rank = document.createElement('td');
    const rankClass =
      officialCategoryView && idx === 0
        ? ' is-first'
        : officialCategoryView && idx === 1
          ? ' is-second'
          : officialCategoryView && idx === 2
            ? ' is-third'
            : '';
    rank.className = `col-rank rank${rankClass}`;
    rank.textContent = String(idx + 1).padStart(2, '0');

    const check = document.createElement('td');
    check.className = 'col-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selected.has(r.id);
    cb.setAttribute('aria-label', t('table.select'));
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => toggleSelect(r.id, cb.checked));
    check.appendChild(cb);

    const veh = document.createElement('td');
    veh.className = 'col-vehicle vehicle';
    const chip = document.createElement('span');
    chip.className = 'brand-chip';
    chip.setAttribute('aria-hidden', 'true');
    chip.textContent = r.brand;
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'vehicle-link';
    name.textContent = r.vehicle_en;
    name.title = t('vehicle.open');
    name.addEventListener('click', (e) => {
      e.stopPropagation();
      openVehicleTicket(r.vehicle_en, r.id);
    });
    veh.append(chip, name);
    if (r.vehicle_zh && getLang() === 'zh') {
      const sub = document.createElement('small');
      sub.textContent = r.vehicle_zh;
      veh.appendChild(sub);
    }

    const time = document.createElement('td');
    time.className = 'col-time time';
    time.textContent = r.lap_time_display;

    const driver = document.createElement('td');
    driver.className = 'col-driver driver';
    driver.textContent = r.driver_en || (getLang() === 'zh' ? '（官方未列）' : '— (not listed)');

    const date = document.createElement('td');
    date.className = 'col-date date';
    date.textContent = r.record_date;

    const cat = document.createElement('td');
    cat.className = 'col-cat cat';
    const catBtn = document.createElement('button');
    catBtn.type = 'button';
    catBtn.className = 'cat-jump';
    catBtn.textContent = classLabel(classKeyOf(r.category_id));
    catBtn.title = `${t('ui.jumpToCategory')} · ${t('ui.officialCategory')}: ${catLabelQualified(r.category_id)}`;
    catBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectClass(classKeyOf(r.category_id));
    });
    cat.appendChild(catBtn);

    const src = document.createElement('td');
    src.className = 'col-src';
    const a = document.createElement('a');
    a.className = 'src-link';
    a.href = r.source_url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'nuerburgring.de';
    a.addEventListener('click', (e) => e.stopPropagation());
    src.appendChild(a);

    // mobile expand target
    tr.addEventListener('click', () => {
      state.activeId = r.id;
      tr.classList.toggle('is-expanded');
      document.querySelectorAll('#board-body tr').forEach((x) => x.classList.remove('is-active'));
      tr.classList.add('is-active');
      renderDetail(r.id);
      const side = document.querySelector('.side');
      if (side && window.matchMedia('(max-width: 1100px)').matches) side.classList.add('is-open');
    });

    tr.append(check, rank, veh, time, driver, date, cat, src);
    tbody.appendChild(tr);
  });

  $('#compare-count').textContent = String(state.selected.size);
  $('#open-compare').disabled = state.selected.size < 2;
}

function youtubeId(url) {
  if (!url) return '';
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/,
  );
  return m ? m[1] : '';
}

/** Prefer curated promo clip, else official onboard from the record. */
function mediaForVehicle(vehicleName) {
  const spec = vehicleSpecEntry(vehicleName);
  const promo = spec?.promoVideo || spec?.promo_video || '';
  if (promo) {
    const id = youtubeId(promo);
    if (id) return { type: 'youtube', id, url: promo };
    if (/\.mp4($|\?)/i.test(promo) || /\.webm($|\?)/i.test(promo)) {
      return { type: 'file', url: promo };
    }
  }
  const rec = recordsForVehicle(vehicleName).find((r) => r.video_url);
  const id = rec ? youtubeId(rec.video_url) : '';
  if (id) return { type: 'youtube', id, url: rec.video_url };
  return null;
}

let mediaBgTimer = 0;
let mediaMuted = false;
const MEDIA_VOLUME = 0.5;

function updateMuteButton() {
  const btn = $('#media-mute-btn');
  if (!btn) return;
  const hide = !document.body.classList.contains('has-media-bg');
  btn.hidden = hide;
  btn.title = mediaMuted ? 'Unmute' : 'Mute';
  btn.setAttribute('aria-label', btn.title);
  const mutedIcon = btn.querySelector('.icon-muted');
  const unmutedIcon = btn.querySelector('.icon-unmuted');
  if (mutedIcon) {
    if (mediaMuted) mutedIcon.removeAttribute('hidden');
    else mutedIcon.setAttribute('hidden', '');
  }
  if (unmutedIcon) {
    if (mediaMuted) unmutedIcon.setAttribute('hidden', '');
    else unmutedIcon.removeAttribute('hidden');
  }
}

function ytPost(iframe, func, args = []) {
  if (!iframe?.contentWindow) return;
  const origin = window.location.origin;
  const payload = { event: 'command', func, args, id: 'rr-media' };
  try {
    iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'rr-media' }), origin);
    iframe.contentWindow.postMessage(JSON.stringify(payload), origin);
    // some embeds only accept '*'
    iframe.contentWindow.postMessage(JSON.stringify(payload), '*');
  } catch {
    /* ignore */
  }
}

function applyMuteState() {
  const layer = $('#media-bg');
  if (!layer) return;
  const video = layer.querySelector('video');
  if (video) {
    video.muted = mediaMuted;
    video.volume = mediaMuted ? 0 : MEDIA_VOLUME;
    if (!mediaMuted) video.play().catch(() => {});
  }
  const iframe = layer.querySelector('iframe');
  if (iframe) {
    if (mediaMuted) {
      ytPost(iframe, 'mute', []);
      ytPost(iframe, 'setVolume', [0]);
    } else {
      ytPost(iframe, 'unMute', []);
      ytPost(iframe, 'setVolume', [50]);
    }
  }
  updateMuteButton();
}

function toggleMediaMute() {
  mediaMuted = !mediaMuted;
  // Never reload the player — mute only via player commands
  applyMuteState();
}

function showMediaBackground(media) {
  const layer = $('#media-bg');
  if (!layer) return;
  clearTimeout(mediaBgTimer);
  layer.innerHTML = '';
  layer.hidden = true;
  layer.classList.remove('is-on');
  document.body.classList.remove('has-media-bg');
  mediaMuted = false;
  updateMuteButton();
  if (!media) return;

  if (media.type === 'file') {
    const v = document.createElement('video');
    v.src = media.url;
    v.muted = mediaMuted;
    v.volume = mediaMuted ? 0 : MEDIA_VOLUME;
    v.loop = true;
    v.autoplay = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.addEventListener('error', () => hideMediaBackground(), { once: true });
    layer.appendChild(v);
    layer.hidden = false;
    document.body.classList.add('has-media-bg');
    requestAnimationFrame(() => layer.classList.add('is-on'));
    updateMuteButton();
    // user gesture from opening the drawer — allow sound; fall back to muted autoplay if blocked
    v.play().catch(() => {
      v.muted = true;
      return v.play().catch(() => hideMediaBackground());
    });
    return;
  }

  if (media.type === 'youtube' && media.id) {
    const iframe = document.createElement('iframe');
    // enablejsapi required for mute/unMute commands
    const origin = encodeURIComponent(window.location.origin);
    iframe.src = `https://www.youtube-nocookie.com/embed/${media.id}?autoplay=1&mute=${mediaMuted ? 1 : 0}&loop=1&playlist=${media.id}&controls=1&showinfo=0&rel=0&modestbranding=1&playsinline=1&fs=1&iv_load_policy=3&enablejsapi=1&origin=${origin}`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.title = 'vehicle background';
    iframe.addEventListener('error', () => hideMediaBackground());
    layer.appendChild(iframe);
    layer.hidden = false;
    document.body.classList.add('has-media-bg');
    requestAnimationFrame(() => layer.classList.add('is-on'));
    updateMuteButton();
    const setYtAudio = () => {
      if (mediaMuted) {
        ytPost(iframe, 'mute', []);
        ytPost(iframe, 'setVolume', [0]);
      } else {
        ytPost(iframe, 'unMute', []);
        ytPost(iframe, 'setVolume', [50]);
      }
    };
    iframe.addEventListener('load', setYtAudio);
    setTimeout(setYtAudio, 600);
    setTimeout(setYtAudio, 1800);
    mediaBgTimer = window.setTimeout(() => {
      if (!layer.querySelector('iframe, video')) hideMediaBackground();
    }, 4000);
  }
}

function hideMediaBackground() {
  clearTimeout(mediaBgTimer);
  const layer = $('#media-bg');
  if (layer) {
    layer.classList.remove('is-on');
    layer.innerHTML = '';
    layer.hidden = true;
  }
  document.body.classList.remove('has-media-bg');
  updateMuteButton();
}

/**
 * Official still only:
 * 1) photo_url (nuerburgring.de / official media bucket, from sync)
 * 2) YouTube thumbnail from official onboard (may be blocked on some networks)
 * Never substitute with generated art — missing media shows 暂无资料.
 */
function trackPhotoFor(r) {
  const yt = youtubeId(r.video_url);
  const official = r.photo_url || '';
  const ytThumb = yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : '';
  const src = official || ytThumb;
  return {
    src,
    fallback: official ? '' : ytThumb, // if yt fails and we already used official, stop
    finalFallback: '',
    href: r.video_url || r.source_url,
    credit: official ? 'official-still' : yt ? 'official-still' : 'none',
    hasOfficial: Boolean(src),
  };
}

function renderDetail(id) {
  const r = allRecords().find((x) => x.id === id);
  const body = $('#detail-body');
  if (!r) {
    body.innerHTML = `<p class="muted">${t('detail.hint')}</p>`;
    return;
  }
  const tm = trackMeta(r.track_id);
  const miss = missing();
  const photo = trackPhotoFor(r);
  const vehicleBtn = `<button type="button" class="vehicle-link" data-open-vehicle="${escapeAttr(r.vehicle_en)}">${escapeHtml(r.vehicle_en)}</button>`;

  const photoHtml = photo.hasOfficial
    ? `
    <figure class="detail-photo" data-missing="${escapeAttr(miss)}">
      <a class="detail-photo__link" href="${escapeAttr(photo.href)}" target="_blank" rel="noopener">
        <img
          class="detail-photo__img"
          src="${escapeAttr(photo.src)}"
          ${photo.fallback ? `data-f1="${escapeAttr(photo.fallback)}"` : ''}
          alt="${escapeHtml(r.vehicle_en)} — ${escapeHtml(t('detail.trackPhoto'))}"
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          onerror="const s=[this.dataset.f1].filter(Boolean); const n=Number(this.dataset.fb||0); if (n<s.length) { this.dataset.fb=String(n+1); this.src=s[n]; } else { this.closest('.detail-photo').classList.add('is-missing'); this.remove(); }"
        />
      </a>
      <figcaption class="detail-photo__cap">
        <span>${t('detail.photoOfficial')}</span>
        ${
          photo.href
            ? `<a href="${escapeAttr(photo.href)}" target="_blank" rel="noopener">${t('detail.video')}</a>`
            : ''
        }
      </figcaption>
    </figure>`
    : `
    <figure class="detail-photo is-missing" data-missing="${escapeAttr(miss)}">
      <div class="detail-photo__empty">${escapeHtml(miss)}</div>
      <figcaption class="detail-photo__cap">
        <span>${t('detail.trackPhoto')}</span>
        ${
          r.video_url
            ? `<a href="${escapeAttr(r.video_url)}" target="_blank" rel="noopener">${t('detail.video')}</a>`
            : `<a href="${escapeAttr(r.source_url)}" target="_blank" rel="noopener">${t('detail.source')}</a>`
        }
      </figcaption>
    </figure>`;

  body.innerHTML = `
    ${photoHtml}
    <p class="detail-time">${r.lap_time_display}</p>
    <dl class="detail-kv">
      <dt>${t('detail.vehicle')}</dt><dd>${vehicleBtn}</dd>
      <dt>${t('detail.brand')}</dt><dd>${escapeHtml(r.brand)}</dd>
      <dt>${t('detail.driver')}</dt><dd>${r.driver_en ? escapeHtml(r.driver_en) : `<span class="miss">${miss}</span>`}</dd>
      <dt>${t('detail.date')}</dt><dd>${r.record_date}</dd>
      <dt>${t('detail.category')}</dt><dd>${escapeHtml(catLabel(r.category_id))}<br><span class="muted">${escapeHtml(r.category_id)}</span></dd>
      <dt>${t('detail.track')}</dt><dd>${escapeHtml(trackLabel(r.track_id))} · ${tm ? tm.distance_km + ' km' : ''}<br><span class="muted">${tm ? tm.timing_key : ''}</span></dd>
      <dt>${t('detail.time')}</dt><dd><span class="time">${r.lap_time_display}</span> <span class="muted">(${r.lap_time_ms} ms · raw ${escapeHtml(r.lap_time_raw)})</span></dd>
      <dt>${t('detail.video')}</dt><dd>${
        r.video_url
          ? `<a href="${escapeAttr(r.video_url)}" target="_blank" rel="noopener">YouTube</a>`
          : `<span class="miss">${miss}</span>`
      }</dd>
      <dt>${t('detail.source')}</dt><dd><a href="${escapeAttr(r.source_url)}" target="_blank" rel="noopener">nuerburgring.de</a></dd>
      <dt>${t('detail.note')}</dt><dd>${r.official_note ? escapeHtml(r.official_note) : `<span class="miss">${miss}</span>`}</dd>
    </dl>
  `;
}

function renderNews() {
  const list = $('#news-list');
  list.innerHTML = '';
  const items = state.data?.news_items || [];
  if (!items.length) {
    list.innerHTML = `<p class="muted">${missing()}</p>`;
    return;
  }
  for (const n of items.slice(0, 8)) {
    const art = document.createElement('article');
    art.className = 'news-item';
    const title = getLang() === 'zh' && n.title_zh ? n.title_zh : n.title_en;
    const summary =
      getLang() === 'zh' && n.summary_zh ? n.summary_zh : n.summary_en || '';
    const tag =
      getLang() === 'zh' && n.summary_zh && n.summary_zh_is_site_translation
        ? `<span class="tl-tag">${t('news.siteTranslation')}</span>`
        : '';
    art.innerHTML = `
      <h3><a href="${escapeAttr(n.source_url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>${tag}</h3>
      <div class="news-date">${n.published_at}</div>
      <p>${escapeHtml(truncate(summary, 220))}</p>
      <p><a href="${escapeAttr(n.source_url)}" target="_blank" rel="noopener">${t('news.viewOriginal')}</a></p>
    `;
    list.appendChild(art);
  }
}

function renderNotice() {
  const meta = state.data?.meta || {};
  if (state.sourceMode === 'static') {
    showNotice(t('notice.static'));
    return;
  }
  const staleAfter = meta.stale_after_minutes || 180;
  const lastOk = meta.last_success_at;
  if (!lastOk) {
    showNotice(t('notice.fail'), true);
    return;
  }
  const ageMs = Date.now() - Date.parse(lastOk);
  if (meta.is_stale || ageMs > staleAfter * 60_000) {
    showNotice(`${t('notice.stale')} ${lastOk}`);
    return;
  }
  if (meta.last_status === 'failed') {
    showNotice(t('notice.fail'), true);
    return;
  }
  hideNotice();
}

function showNotice(text, bad = false) {
  const el = $('#notice');
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle('is-bad', bad);
}

function hideNotice() {
  $('#notice').hidden = true;
}

function renderSyncPill() {
  const meta = state.data?.meta || {};
  if (state.sourceMode === 'static') {
    $('#sync-dot').className = 'sync-dot is-warn';
    $('#sync-text').textContent = t('notice.static').slice(0, 28) + '…';
    $('#sync-pill').title = `${t('sync.lastSuccess')}: ${meta.last_success_at || t('sync.never')}`;
    return;
  }
  renderSyncFromStatus(meta);
}

function renderSyncFromStatus(status) {
  const dot = $('#sync-dot');
  const text = $('#sync-text');
  if (status.last_status === 'failed') {
    dot.className = 'sync-dot is-bad';
    text.textContent = t('sync.fail');
  } else if (status.is_stale) {
    dot.className = 'sync-dot is-warn';
    text.textContent = t('sync.stale');
  } else {
    dot.className = 'sync-dot is-ok';
    text.textContent = t('sync.ok');
  }
  $('#sync-pill').title = `${t('sync.lastCheck')}: ${status.last_check_at || '—'}\n${t('sync.lastSuccess')}: ${
    status.last_success_at || '—'
  }`;
  renderHeroStats();
}

// ---------- compare ----------

function toggleSelect(id, on) {
  if (on) {
    if (state.selected.size >= 4) {
      alert(t('compare.max'));
      renderBoard();
      return;
    }
    state.selected.add(id);
  } else {
    state.selected.delete(id);
  }
  renderBoard();
}

function openCompare() {
  const ids = [...state.selected];
  const rows = ids.map((id) => allRecords().find((r) => r.id === id)).filter(Boolean);
  const body = $('#compare-body');
  if (rows.length < 2) {
    body.innerHTML = `<p class="muted">${t('compare.hint')}</p>`;
  } else {
    const base = rows.reduce((a, b) => (a.lap_time_ms <= b.lap_time_ms ? a : b));
    const sameTiming =
      new Set(rows.map((r) => `${r.track_id}:${trackMeta(r.track_id)?.timing_key || ''}`)).size === 1;

    let html = `<table class="compare-table"><thead><tr>
      <th>${t('table.time')}</th><th>${t('table.vehicle')}</th><th>${t('table.driver')}</th>
      <th>${t('table.category')}</th><th>${t('table.date')}</th><th>${t('compare.deltaBase')}</th>
    </tr></thead><tbody>`;

    for (const r of [...rows].sort((a, b) => a.lap_time_ms - b.lap_time_ms)) {
      let delta = '';
      if (!sameTiming) {
        delta = `<span class="delta-na">${t('compare.incomparable')}</span>`;
      } else if (r.id === base.id) {
        delta = `<span class="delta-faster">BASE</span>`;
      } else {
        const d = r.lap_time_ms - base.lap_time_ms;
        const sign = d >= 0 ? '+' : '−';
        const abs = Math.abs(d);
        const secs = `${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
        delta = `<span class="${d > 0 ? 'delta-slower' : 'delta-faster'}">${sign}${secs}s</span>`;
      }
      html += `<tr>
        <td class="time">${r.lap_time_display}</td>
        <td>${escapeHtml(r.vehicle_en)}</td>
        <td>${r.driver_en ? escapeHtml(r.driver_en) : '—'}</td>
        <td>${escapeHtml(catLabel(r.category_id))}</td>
        <td class="date">${r.record_date}</td>
        <td>${delta}</td>
      </tr>`;
    }
    html += `</tbody></table>`;
    if (!sameTiming) {
      html += `<p class="muted" style="margin-top:10px">${t('compare.incomparable')}</p>`;
    }
    body.innerHTML = html;
  }
  $('#compare-drawer').hidden = false;
}

// ---------- utils ----------

function vehicleSlug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function recordsForVehicle(vehicleName) {
  const key = String(vehicleName).toLowerCase();
  return allRecords()
    .filter((r) => String(r.vehicle_en).toLowerCase() === key)
    .sort((a, b) => a.lap_time_ms - b.lap_time_ms);
}

function vehicleSpecEntry(vehicleName) {
  const specs = state.vehicleSpecs?.vehicles || {};
  const slug = vehicleSlug(vehicleName);
  if (specs[slug]) return specs[slug];
  // fallback: match by official name
  const key = Object.keys(specs).find(
    (k) => String(specs[k].name_en || '').toLowerCase() === String(vehicleName).toLowerCase(),
  );
  return key ? specs[key] : null;
}

let tearTicketInstance = null;
let pendingVehicle = null;

function openVehicleTicket(vehicleName, focusRecordId) {
  pendingVehicle = { vehicleName, focusRecordId };
  const records = recordsForVehicle(vehicleName);
  const sample = records.find((r) => r.id === focusRecordId) || records[0];
  const photo = sample ? trackPhotoFor(sample) : null;
  const best = records[0];
  const gate = $('#ticket-gate');
  const mount = $('#tear-ticket-root');
  if (!gate || !mount) {
    openVehicleModal(vehicleName, focusRecordId);
    return;
  }

  tearTicketInstance?.destroy?.();
  mount.innerHTML = '';

  const body = `
    <div class="ticket-brand">${t('ticket.record')}</div>
    <h3 class="ticket-title">${escapeHtml(vehicleName)}</h3>
    <p class="ticket-meta">${best ? `${best.lap_time_display} · ${escapeHtml(trackLabel(best.track_id))}` : escapeHtml(sample?.brand || '')}</p>
    <p class="ticket-hint">${t('ticket.tearHint')}</p>
  `;
  const stub = `
    <div>
      <div class="ticket-stub-label">${t('ticket.admit')}</div>
      <div class="ticket-stub-sub">${t('ticket.stubHint')}</div>
    </div>
    <div class="ticket-stub-no">No. ${String(Math.abs(hashCode(vehicleName)) % 1000000).padStart(6, '0')}</div>
  `;

  tearTicketInstance = mountTearTicket(mount, {
    // Official still only — empty when unavailable (no generated art)
    image: photo?.hasOfficial ? photo.src : '',
    imageAlt: vehicleName,
    bodyHtml: body,
    stubHtml: stub,
    width: 520,
    height: 260,
    stubSize: 148,
    background: '#1c2229',
    color: '#f5f5f5',
    onTear: () => {
      // Cinematic handoff: ticket slowly dissolves → video fades in → panel slides in late
      gate.classList.add('is-leaving');
      const p = pendingVehicle;
      pendingVehicle = null;
      // start media under the dissolving ticket
      if (p) openVehicleMediaOnly(p.vehicleName);
      const enter = () => {
        gate.hidden = true;
        gate.classList.remove('is-leaving');
        if (!p) return;
        openVehicleModal(p.vehicleName, p.focusRecordId);
        const vm = $('#vehicle-modal');
        if (vm) {
          vm.classList.add('is-entering');
          setTimeout(() => vm.classList.remove('is-entering'), 1000);
        }
      };
      // wait for the ticket exit to be clearly visible
      setTimeout(enter, 950);
    },
  });

  // Official image with YouTube still as secondary — never generated art
  if (photo?.hasOfficial) {
    const img = mount.querySelector('.tear-ticket__image');
    if (img) {
      img.addEventListener(
        'error',
        () => {
          if (img.dataset.fb || !photo.fallback) {
            img.remove();
            mount.classList.add('tear-ticket--no-image');
            return;
          }
          img.dataset.fb = '1';
          img.src = photo.fallback;
        },
        { once: true },
      );
      img.src = photo.src;
    }
  } else {
    mount.classList.add('tear-ticket--no-image');
  }

  gate.hidden = false;
}

function closeTicketGate() {
  $('#ticket-gate').hidden = true;
  tearTicketInstance?.destroy?.();
  tearTicketInstance = null;
  pendingVehicle = null;
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/** Start vehicle media under the ticket exit (without opening the panel yet). */
function openVehicleMediaOnly(vehicleName) {
  showMediaBackground(mediaForVehicle(vehicleName));
}

function openVehicleModal(vehicleName, focusRecordId) {
  const records = recordsForVehicle(vehicleName);
  const sample = records.find((r) => r.id === focusRecordId) || records[0];
  const spec = vehicleSpecEntry(vehicleName);
  const miss = missing();
  const photo = sample ? trackPhotoFor(sample) : null;
  const title = $('#vehicle-modal-title');
  title.textContent = vehicleName;

  const specVal = (v) => {
    if (!v) return `<span class="miss">${miss}</span>`;
    const text = getLang() === 'zh' && v.zh ? v.zh : v.en || v.zh || '';
    return escapeHtml(text);
  };

  const powertrain = spec?.powertrain
    ? t(`powertrain.${spec.powertrain}`) !== `powertrain.${spec.powertrain}`
      ? t(`powertrain.${spec.powertrain}`)
      : spec.powertrain
    : miss;

  const best = records[0];
  let rowsHtml = '';
  for (const r of records) {
    rowsHtml += `<tr>
      <td class="time">${r.lap_time_display}</td>
      <td>${escapeHtml(trackLabel(r.track_id))}</td>
      <td>${escapeHtml(classLabel(classKeyOf(r.category_id)))}</td>
      <td>${r.driver_en ? escapeHtml(r.driver_en) : '—'}</td>
      <td class="date">${r.record_date}</td>
      <td>${
        r.video_url
          ? `<a href="${escapeAttr(r.video_url)}" target="_blank" rel="noopener">${t('detail.video')}</a>`
          : `<a href="${escapeAttr(r.source_url)}" target="_blank" rel="noopener">${t('detail.source')}</a>`
      }</td>
    </tr>`;
  }

  const sources = spec?.sources || [];
  const sourcesHtml = sources.length
    ? sources
        .map(
          (u) =>
            `<a href="${escapeAttr(u)}" target="_blank" rel="noopener">${escapeHtml(String(u).replace(/^https?:\/\//, '').slice(0, 48))}</a>`,
        )
        .join(' · ')
    : `<span class="miss">${miss}</span>`;

  $('#vehicle-modal-body').innerHTML = `
    <div class="vehicle-head">
      ${
        photo
          ? `<img class="vehicle-head__photo" src="${escapeAttr(photo.src)}" alt="${escapeHtml(vehicleName)}" data-f1="${escapeAttr(photo.fallback)}" data-f2="${escapeAttr(photo.finalFallback)}" onerror="const s=[this.dataset.f1,this.dataset.f2].filter(Boolean); const n=Number(this.dataset.fb||0); if (n<s.length) { this.dataset.fb=String(n+1); this.src=s[n]; } else { this.remove(); }" />`
          : ''
      }
      <div class="vehicle-head__meta">
        <p class="vehicle-head__name">${escapeHtml(vehicleName)}</p>
        <p class="vehicle-head__brand">${escapeHtml(sample?.brand || miss)} · ${escapeHtml(powertrain)}${
          spec?.body ? ` · ${escapeHtml(getLang() === 'zh' && spec.body.zh ? spec.body.zh : spec.body.en)}` : ''
        }</p>
        <p class="muted" style="margin:8px 0 0">${t('vehicle.recordCount')}: <strong>${records.length}</strong>${
          best
            ? ` · ${t('vehicle.best')}: <span class="time">${best.lap_time_display}</span> (${escapeHtml(trackLabel(best.track_id))})`
            : ''
        }</p>
      </div>
    </div>

    <h3 class="panel__title" style="margin-top:8px">${t('vehicle.specs')}</h3>
    ${
      spec?.specs
        ? `<dl class="spec-grid">
            <dt>${t('vehicle.power')}</dt><dd>${specVal(spec.specs.power)}</dd>
            <dt>${t('vehicle.engine')}</dt><dd>${specVal(spec.specs.engine)}</dd>
            <dt>${t('vehicle.weight')}</dt><dd>${specVal(spec.specs.weight)}</dd>
            <dt>${t('vehicle.drive')}</dt><dd>${specVal(spec.specs.drive)}</dd>
          </dl>`
        : `<p class="muted">${t('vehicle.noSpecs')}</p>`
    }
    <p class="muted">${t('vehicle.note')}</p>

    <h3 class="panel__title">${t('vehicle.records')}</h3>
    <table class="vehicle-records">
      <thead><tr>
        <th>${t('table.time')}</th><th>${t('filter.track')}</th><th>${t('table.category')}</th>
        <th>${t('table.driver')}</th><th>${t('table.date')}</th><th>${t('table.source')}</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <h3 class="panel__title">${t('vehicle.sources')}</h3>
    <p class="muted">${sourcesHtml}</p>
  `;

  $('#vehicle-modal').hidden = false;

  // Media may already be fading in from the ticket exit — don't restart it
  if (!document.body.classList.contains('has-media-bg')) {
    showMediaBackground(mediaForVehicle(vehicleName));
  }
}

function closeVehicleModal() {
  $('#vehicle-modal').hidden = true;
  const panel = document.querySelector('#vehicle-modal .modal--vehicle');
  if (panel) panel.classList.remove('is-collapsed');
  hideMediaBackground();
}

function toggleVehicleDrawer() {
  const panel = document.querySelector('#vehicle-modal .modal--vehicle');
  if (!panel) return;
  const collapsed = panel.classList.toggle('is-collapsed');
  const btn = $('#vehicle-drawer-toggle');
  if (btn) {
    btn.title = collapsed ? t('vehicle.expand') : t('vehicle.collapse');
    btn.setAttribute('aria-label', collapsed ? t('vehicle.expand') : t('vehicle.collapse'));
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", '&#39;');
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

// ---------- events ----------

function bindEvents() {
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setLang(btn.dataset.lang);
      document.querySelectorAll('.lang-btn').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.lang === getLang()));
      });
      applyStaticI18n();
      renderAll();
      renderNotice();
      renderSyncPill();
    });
  });

  $('#search').addEventListener('input', (e) => {
    state.q = e.target.value.trim();
    renderBoard();
  });

  $('#filter-brand').addEventListener('change', (e) => {
    state.brand = e.target.value;
    renderBoard();
  });
  $('#filter-year').addEventListener('change', (e) => {
    state.year = e.target.value;
    renderBoard();
  });
  $('#filter-power').addEventListener('change', (e) => {
    state.powertrain = e.target.value;
    // 动力形式只是筛选条件，保留当前车型分类
    renderAll();
  });
  $('#reset-filters').addEventListener('click', () => {
    state.brand = '';
    state.year = '';
    state.powertrain = '';
    state.q = '';
    state.classKey = null;
    $('#search').value = '';
    $('#filter-brand').value = '';
    $('#filter-year').value = '';
    $('#filter-power').value = '';
    renderAll();
  });

  $('#open-compare').addEventListener('click', openCompare);
  $('#close-compare').addEventListener('click', () => {
    $('#compare-drawer').hidden = true;
  });
  document.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', () => {
      $('#compare-drawer').hidden = true;
    });
  });

  $('#close-vehicle')?.addEventListener('click', closeVehicleModal);
  $('#vehicle-drawer-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleVehicleDrawer();
  });
  $('#media-mute-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMediaMute();
  });
  document.querySelectorAll('[data-close-vehicle]').forEach((el) => {
    el.addEventListener('click', closeVehicleModal);
  });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open-vehicle]');
    if (btn) {
      e.stopPropagation();
      openVehicleTicket(btn.getAttribute('data-open-vehicle'));
    }
    if (e.target.closest('[data-close-ticket]')) {
      closeTicketGate();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const panel = document.querySelector('#vehicle-modal .modal--vehicle');
      if (panel?.classList.contains('is-collapsed')) {
        panel.classList.remove('is-collapsed');
        return;
      }
      $('#compare-drawer').hidden = true;
      closeVehicleModal();
    }
  });
}

// ---------- boot ----------

function bindSpotlightCards() {
  document.querySelectorAll('.spotlight-card').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
      card.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
    });
  });
}

function boot() {
  setLang(getLang());
  document.querySelectorAll('.lang-btn').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === getLang()));
  });
  applyStaticI18n();
  bindEvents();
  bindSpotlightCards();
  // one continuous dither surface under hero + app (reactbits Dither)
  const canvas = document.getElementById('dither-bg');
  if (canvas) {
    initDitherBackground(canvas, {
      waveColor: [0.55, 0.42, 0.42],
      backgroundColor: [0.03, 0.03, 0.035],
      colorNum: 4,
      pixelSize: 2,
      waveSpeed: 0.05,
      waveFrequency: 3,
      waveAmplitude: 0.3,
      enableMouseInteraction: true,
      mouseRadius: 0.35,
    });
  }
  loadData();
  fetch('./data/vehicle-specs.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j?.vehicles) state.vehicleSpecs = j;
    })
    .catch(() => {});
  // ensure media bg never sticks if user reloads mid-modal
  hideMediaBackground();
  state.pollTimer = setInterval(pollVersion, 60_000);
}

boot();
