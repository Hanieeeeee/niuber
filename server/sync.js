/**
 * Fetch + parse + validate + publish sync pipeline.
 * Failure never wipes the previous valid dataset.
 */

import { createHash } from 'node:crypto';
import {
  parseRecordsHtml,
  parseNewsHtml,
  parseNewsNextPage,
  discoverWidgetUrls,
  unwrapWidgetResponse,
  RECORDS_URL_EN,
  NEWS_URL_EN,
} from '../adapters/official-html.js';
import { TRACKS } from '../adapters/categories.js';
import { upsert, startSyncRun, finishSyncRun, publishSnapshot, query } from './db.js';

const UA =
  process.env.RR_HTTP_USER_AGENT ||
  'RingRecords/1.0 (independent archive; contact: admin@example.invalid)';
const TIMEOUT = Number(process.env.RR_HTTP_TIMEOUT_MS || 20000);
const RETRIES = Number(process.env.RR_HTTP_RETRIES || 3);

async function fetchText(url, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const isWidget = /\/widget\//.test(url);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: isWidget ? 'text/html, */*; q=0.01' : 'text/html,application/xhtml+xml',
        'Accept-Language': 'en',
        ...(isWidget
          ? {
              'X-Requested-With': 'XMLHttpRequest',
              Referer: RECORDS_URL_EN,
            }
          : {}),
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (err) {
    if (attempt < RETRIES) {
      await new Promise((r) => setTimeout(r, 800 * attempt));
      return fetchText(url, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function ensureTracks() {
  for (const t of TRACKS) {
    upsert('tracks', { ...t }, ['id']);
  }
}

function validateRecords(records) {
  const errors = [];
  if (!Array.isArray(records) || records.length === 0) {
    errors.push('no records parsed — refusing to publish empty batch');
    return errors;
  }
  for (const r of records) {
    if (!Number.isInteger(r.lap_time_ms) || r.lap_time_ms <= 0) errors.push(`bad ms: ${r.id}`);
    if (!r.lap_time_display || !/^\d{2}:\d{2}\.\d{3}$/.test(r.lap_time_display)) {
      errors.push(`bad display: ${r.id} ${r.lap_time_display}`);
    }
    if (!r.category_id || !r.track_id || !r.vehicle_en || !r.record_date) {
      errors.push(`missing fields: ${r.id}`);
    }
    if (!r.source_url || !/nuerburgring\.de/.test(r.source_url)) {
      errors.push(`missing official source: ${r.id}`);
    }
  }
  return errors;
}

/**
 * Run one full sync. Safe to call concurrently — second call becomes a no-op wait.
 * @returns {Promise<object>}
 */
export async function runSync() {
  const runId = startSyncRun();
  let recordsSeen = 0;
  let newsSeen = 0;
  let dataVersion = null;
  let status = 'success';
  let error = null;

  try {
    ensureTracks();

    // --- Records ---
    // Official list is composed of `/widget/{id}` endpoints discovered from the page shell.
    const shell = await fetchText(RECORDS_URL_EN);
    const widgetUrls = discoverWidgetUrls(shell);
    if (!widgetUrls.length) {
      throw new Error('no official /widget/ endpoints discovered — refusing to invent data');
    }

    /** @type {import('../adapters/official-html.js').ParsedRecord[]} */
    let allRecords = [];
    /** @type {Map<string, object>} */
    const catMap = new Map();
    const warnings = [];

    for (const url of widgetUrls) {
      const body = await fetchText(url);
      const fragment = unwrapWidgetResponse(body);
      // Skip non-record widgets (partners, PR forms, KBA tables without lap times)
      if (!/contenttable|accordion-inline|Lap time|Rekordzeit/i.test(fragment)) continue;
      const parsed = parseRecordsHtml(fragment, RECORDS_URL_EN);
      for (const c of parsed.categories) {
        if (!catMap.has(c.id)) catMap.set(c.id, { ...c, source_url: RECORDS_URL_EN });
      }
      allRecords = allRecords.concat(parsed.records);
      warnings.push(...parsed.warnings);
    }

    // Fallback: full page (already-hydrated HTML) if widgets returned nothing
    if (!allRecords.length) {
      const parsed = parseRecordsHtml(shell, RECORDS_URL_EN);
      allRecords = parsed.records;
      for (const c of parsed.categories) {
        if (!catMap.has(c.id)) catMap.set(c.id, { ...c, source_url: RECORDS_URL_EN });
      }
      warnings.push(...parsed.warnings);
    }

    const parsed = {
      records: allRecords,
      categories: [...catMap.values()],
      warnings,
    };
    const errors = validateRecords(parsed.records);
    if (errors.length) {
      // keep previous data
      throw new Error(`integrity check failed: ${errors.slice(0, 5).join('; ')}`);
    }

    for (const cat of parsed.categories) {
      upsert(
        'categories',
        {
          id: cat.id,
          track_id: cat.track_id,
          parent_id: cat.parent_id ?? null,
          group_en: cat.group_en,
          group_zh: cat.group_zh,
          name_en: cat.name_en,
          name_zh: cat.name_zh,
          name_official: cat.name_official,
          sort_order: cat.sort_order ?? 0,
          source_url: cat.source_url || RECORDS_URL_EN,
        },
        ['id'],
      );
    }

    // Deduplicate by primary identity — different kits / versions stay separate rows.
    const dedup = new Map();
    for (const r of parsed.records) {
      const key = r.id;
      if (!dedup.has(key)) dedup.set(key, r);
    }
    for (const r of dedup.values()) {
      upsert(
        'records',
        {
          id: r.id,
          track_id: r.track_id,
          category_id: r.category_id,
          vehicle_en: r.vehicle_en,
          vehicle_zh: r.vehicle_zh ?? null,
          brand: r.brand,
          driver_en: r.driver_en ?? null,
          driver_zh: r.driver_zh ?? null,
          lap_time_raw: r.lap_time_raw,
          lap_time_ms: r.lap_time_ms,
          lap_time_display: r.lap_time_display,
          record_date: r.record_date,
          record_date_raw: r.record_date_raw,
          video_url: r.video_url ?? null,
          source_url: r.source_url,
          official_note: r.official_note ?? null,
        },
        ['id'],
      );
      recordsSeen += 1;
    }

    // --- News (first 2 pages, polite) ---
    try {
      let url = NEWS_URL_EN;
      for (let page = 0; page < 2 && url; page += 1) {
        const newsHtml = await fetchText(url);
        const news = parseNewsHtml(newsHtml, url);
        for (const item of news.items) {
          upsert('news_items', item, ['id']);
          newsSeen += 1;
        }
        url = parseNewsNextPage(newsHtml, url);
        if (url) await new Promise((r) => setTimeout(r, 500));
      }
    } catch (newsErr) {
      status = 'partial';
      error = `news: ${newsErr.message}`;
    }

    dataVersion = createHash('sha256')
      .update(
        [...dedup.values()]
          .map((r) => `${r.id}:${r.lap_time_ms}`)
          .sort()
          .join('\n'),
      )
      .digest('hex')
      .slice(0, 16);

    publishSnapshot(dataVersion, recordsSeen, newsSeen);

    finishSyncRun(runId, {
      status,
      records_seen: recordsSeen,
      news_seen: newsSeen,
      error,
      data_version: dataVersion,
    });

    return { ok: true, status, recordsSeen, newsSeen, dataVersion, warnings: parsed.warnings };
  } catch (err) {
    status = 'failed';
    error = err.message;
    // Do NOT clear existing records. Mark run failed.
    const prior = query('SELECT version FROM data_versions ORDER BY published_at DESC LIMIT 1');
    finishSyncRun(runId, {
      status,
      records_seen: recordsSeen,
      news_seen: newsSeen,
      error,
      data_version: prior?.[0]?.version ?? null,
    });
    return { ok: false, status, error, recordsSeen, newsSeen };
  }
}
