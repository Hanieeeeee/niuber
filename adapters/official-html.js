/**
 * HTML adapters for nuerburgring.de (server-rendered pages).
 * Verified structure (2026-04):
 *  - records: section.accordion → article.accordion-inline → table.contenttable
 *  - news:    article blocks under /news/categories/rekordfahrten?page=N
 */

import * as cheerio from 'cheerio';
import { parseLapTimeToMs, formatLapTime, parseOfficialDate, extractBrand } from './time.js';
import { resolveCategory, TRACKS } from './categories.js';

export const RECORDS_URL_EN = 'https://nuerburgring.de/info/nuerburgring/records?locale=en';
export const RECORDS_URL_DE = 'https://nuerburgring.de/info/nuerburgring/records?locale=de';
export const NEWS_URL_EN = 'https://nuerburgring.de/news/categories/rekordfahrten?locale=en';

/**
 * @typedef {object} ParsedRecord
 * @property {string} id
 * @property {string} track_id
 * @property {string} category_id
 * @property {string} vehicle_en
 * @property {string} brand
 * @property {string|null} driver_en
 * @property {string} lap_time_raw
 * @property {number} lap_time_ms
 * @property {string} lap_time_display
 * @property {string} record_date
 * @property {string} record_date_raw
 * @property {string|null} video_url
 * @property {string} source_url
 */

function normalizeText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function recordId(parts) {
  return parts.join('|');
}

/**
 * Infer track + group context from accordion section headings walking up the DOM.
 */
function contextForArticle($, article) {
  let trackId = 'nordschleife';
  let groupDesc = '';
  let sectionTitle = '';

  // nearest section.events__date / accordion section
  const section = $(article).closest('section.events__date');
  if (section.length) {
    sectionTitle = normalizeText(section.find('h3').first().text());
    groupDesc = normalizeText(section.find('p.events__description').first().text());
  }

  // parent widget may hold the track title
  let node = $(article).parent();
  for (let i = 0; i < 6 && node.length; i += 1) {
    const h3 = node.children('h3').first().text();
    const desc = node.find('> p.events__description, > section > p.events__description').first().text();
    if (/grand[\s-]?prix/i.test(h3 + ' ' + sectionTitle)) {
      trackId = 'grand_prix';
      sectionTitle = normalizeText(h3) || sectionTitle;
    }
    if (!groupDesc && desc) groupDesc = normalizeText(desc);
    if (/nordschleife/i.test(h3)) {
      trackId = 'nordschleife';
      sectionTitle = normalizeText(h3) || sectionTitle;
    }
    node = node.parent();
  }

  // global page headings in accordion widgets
  const pageText = $('main').text() || '';
  if (trackId === 'nordschleife' && /record times - grand/i.test(sectionTitle)) {
    trackId = 'grand_prix';
  }

  const categoryTitle = normalizeText(
    $(article).find('.accordion-inline__title').first().text() ||
      $(article).find('h5').first().text(),
  );

  // Fix group from known official banners
  if (!groupDesc) {
    // look at previous siblings of the section
    const prev = section.prev();
    if (prev.length) groupDesc = normalizeText(prev.text());
  }

  void pageText;
  return { trackId, groupDesc, categoryTitle, sectionTitle };
}

function parseRow($, tr) {
  const cells = $(tr)
    .find('td, th')
    .map((_, c) => normalizeText($(c).text()))
    .get();
  if (!cells.length) return null;
  if (/lap time/i.test(cells[0])) return null;

  const video = $(tr).find('a[href*="youtu"]').attr('href') || null;

  // Standard: time, vehicle, driver, date, video
  // Autonomous: time, vehicle, date, video  (no driver)
  let lapTimeRaw, vehicle, driver, dateRaw;
  if (cells.length >= 4 && /\d{4}/.test(cells[cells.length - 1] === '' ? cells[cells.length - 2] || '' : cells[3] || '')) {
    // heuristic
  }

  if (cells.length >= 4 && /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(cells[2])) {
    // time, vehicle, date, (video)
    lapTimeRaw = cells[0];
    vehicle = cells[1];
    driver = null;
    dateRaw = cells[2];
  } else if (cells.length >= 4) {
    lapTimeRaw = cells[0];
    vehicle = cells[1];
    driver = normalizeText(cells[2]) || null;
    dateRaw = cells[3];
  } else if (cells.length === 3) {
    lapTimeRaw = cells[0];
    vehicle = cells[1];
    driver = null;
    dateRaw = cells[2];
  } else {
    return null;
  }

  if (!lapTimeRaw || !vehicle || !dateRaw) return null;

  try {
    const lap_time_ms = parseLapTimeToMs(lapTimeRaw);
    const record_date = parseOfficialDate(dateRaw);
    const brand = extractBrand(vehicle);
    return {
      lap_time_raw: lapTimeRaw,
      lap_time_ms,
      lap_time_display: formatLapTime(lap_time_ms),
      vehicle_en: vehicle,
      brand,
      driver_en: driver,
      record_date,
      record_date_raw: dateRaw,
      video_url: video,
    };
  } catch {
    return null;
  }
}

/**
 * Official page embeds accordion HTML inside jQuery `$('#widget…').replaceWith("…")`
 * bootstrap scripts. Extract and concatenate those fragments so parsers see the
 * same structure a browser would after hydration.
 * @param {string} html
 * @returns {string} HTML containing accordion / news markup when present
 */
export function extractWidgetHtml(html) {
  const parts = [];
  // replaceWith("...") / replaceWith('...') inside script tags
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let sm;
  while ((sm = scriptRe.exec(html))) {
    const body = sm[1] || '';
    if (!/replaceWith|widget_cont|contenttable|accordion-inline/i.test(body)) continue;

    // jQuery-style double-quoted HTML with escaped quotes
    const dq = body.matchAll(/\.replaceWith\(\s*"((?:\\.|[^"\\])*)"\s*\)/g);
    for (const m of dq) {
      parts.push(unescapeJsString(m[1]));
    }
    // single-quoted variant
    const sq = body.matchAll(/\.replaceWith\(\s*'((?:\\.|[^'\\])*)'\s*\)/g);
    for (const m of sq) {
      parts.push(unescapeJsString(m[1]));
    }
  }

  // Also accept already-rendered DOM (in case the official site SSRs tables)
  if (!parts.length) {
    return html;
  }
  return `<html><body><main>${parts.join('\n')}</main></body></html>`;
}

function unescapeJsString(s) {
  return String(s)
    .replace(/\\\//g, '/')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

/**
 * Widget endpoints return a single jQuery replaceWith payload.
 * @param {string} body
 * @returns {string} HTML fragment
 */
export function unwrapWidgetResponse(body) {
  const m = String(body).match(/\.replaceWith\(\s*"((?:\\.|[^"\\])*)"\s*\)/);
  if (m) return unescapeJsString(m[1]);
  const m2 = String(body).match(/\.replaceWith\(\s*'((?:\\.|[^'\\])*)'\s*\)/);
  if (m2) return unescapeJsString(m2[1]);
  return String(body);
}

/**
 * Discover `/widget/{id}` endpoints from the records page shell.
 * @param {string} html
 * @returns {string[]} absolute URLs
 */
export function discoverWidgetUrls(html) {
  const ids = [];
  const re = /data-url="\/widget\/(\d+)"/g;
  let m;
  while ((m = re.exec(html))) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids.map((id) => `https://nuerburgring.de/widget/${id}?locale=en`);
}

/**
 * @param {string} html
 * @param {string} [sourceUrl]
 * @returns {{ records: ParsedRecord[], categories: object[], warnings: string[] }}
 */
export function parseRecordsHtml(html, sourceUrl = RECORDS_URL_EN) {
  const source = extractWidgetHtml(html);
  const $ = cheerio.load(source);
  const warnings = [];
  const records = [];
  const catMap = new Map();

  $('article.accordion-inline').each((_, article) => {
    const ctx = contextForArticle($, article);
    const cat = resolveCategory(ctx.trackId, ctx.groupDesc, ctx.categoryTitle);
    if (!catMap.has(cat.id)) {
      catMap.set(cat.id, { ...cat, source_url: sourceUrl });
    }

    const table = $(article).find('table.contenttable').first();
    if (!table.length) {
      warnings.push(`no table for category ${ctx.categoryTitle}`);
      return;
    }

    table.find('tr').each((__, tr) => {
      const row = parseRow($, tr);
      if (!row) return;
      const id = recordId([
        cat.id,
        row.vehicle_en,
        String(row.lap_time_ms),
        row.record_date,
      ]);
      records.push({
        id,
        track_id: ctx.trackId,
        category_id: cat.id,
        ...row,
        source_url: sourceUrl,
      });
    });
  });

  // sort_order within category by time
  const byCat = new Map();
  for (const r of records) {
    if (!byCat.has(r.category_id)) byCat.set(r.category_id, []);
    byCat.get(r.category_id).push(r);
  }
  for (const list of byCat.values()) {
    list.sort((a, b) => a.lap_time_ms - b.lap_time_ms);
  }

  return {
    records,
    categories: [...catMap.values()],
    warnings,
    trackHints: TRACKS.map((t) => t.id),
  };
}

/**
 * @param {string} html
 * @param {string} [sourceUrl]
 */
export function parseNewsHtml(html, sourceUrl = NEWS_URL_EN) {
  const $ = cheerio.load(extractWidgetHtml(html) === html ? html : extractWidgetHtml(html) + html);
  const items = [];
  const seen = new Set();

  // Featured + list articles have heading + date paragraph + summary
  $('main article').each((_, art) => {
    const $art = $(art);
    const linkEl = $art.find('h4 a, h6 a').first();
    let href = linkEl.attr('href') || $art.find('a[href*="/news/"]').first().attr('href');
    const title = normalizeText(linkEl.text() || $art.find('h4, h6').first().text());
    if (!href || !title) return;
    if (href.startsWith('/')) href = `https://nuerburgring.de${href}`;
    if (!href.includes('nuerburgring.de')) return;

    // date: "04.08.2026" or "04 August, Tuesday"
    let published_at = '';
    const monthMap = {
      january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
    };
    $art.find('p').each((__, p) => {
      const t = normalizeText($(p).text());
      const dm = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (dm && !published_at) {
        published_at = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
        return;
      }
      // featured card: "04 August, Tuesday"
      const em = t.match(/^(\d{1,2})\s+([A-Za-z]+),/);
      if (em && !published_at && monthMap[em[2].toLowerCase()]) {
        const year = String(new Date().getFullYear());
        published_at = `${year}-${monthMap[em[2].toLowerCase()]}-${em[1].padStart(2, '0')}`;
      }
    });

    // summary = longest leaf text block, excluding date lines and the title
    let summary = '';
    const consider = (raw) => {
      let text = normalizeText(raw);
      if (!text || text.length < 40) return;
      if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(text)) return;
      if (/^\d{1,2}\s+[A-Za-z]+,/.test(text) && text.length < 40) return;
      if (text === title) return;
      text = text.replace(/^\d{1,2}\s+[A-Za-z]+,\s+\w+\s*/, '');
      if (title && text.startsWith(title)) text = text.slice(title.length).trim();
      if (text.length > summary.length && text.length > 40) summary = text;
    };
    $art.find('p, .paragraph, .teaser, .description, div').each((__, node) => {
      if ($(node).find('p, .paragraph, article, h4, h6').length) return;
      consider($(node).text());
    });
    // last resort: article text minus title/date
    if (!summary) {
      let full = normalizeText($art.text());
      if (title && full.includes(title)) full = full.replace(title, ' ');
      full = full.replace(/\d{1,2}\s+[A-Za-z]+,\s+\w+/, ' ').replace(/\d{1,2}\.\d{1,2}\.\d{4}/, ' ');
      consider(full);
    }

    const slug = href.replace(/\/$/, '').split('/').pop();
    if (!slug || seen.has(slug)) return;
    seen.add(slug);

    items.push({
      id: slug,
      title_en: title,
      title_zh: null,
      summary_en: summary.slice(0, 1200),
      summary_zh: null,
      summary_zh_is_site_translation: 0,
      published_at: published_at || new Date().toISOString().slice(0, 10),
      source_url: href,
    });
  });

  return { items, sourceUrl };
}

/**
 * Detect next page link on news listing.
 */
export function parseNewsNextPage(html, baseUrl = NEWS_URL_EN) {
  const $ = cheerio.load(html);
  const more = $('a').filter((_, a) => /^more$/i.test(normalizeText($(a).text()))).first();
  let href = more.attr('href');
  if (!href) return null;
  if (href.startsWith('/')) href = `https://nuerburgring.de${href}`;
  // only follow rekordfahrten pagination
  if (!href.includes('rekordfahrten')) return null;
  void baseUrl;
  return href;
}
