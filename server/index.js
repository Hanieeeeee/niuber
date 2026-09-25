/**
 * Ring Records HTTP API + static frontend + optional in-process scheduler.
 */

import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import { runSync } from './sync.js';
import { buildPublishedPayload, isJsonMode, getDbPath, query, get } from './db.js';
import { categoryTree, SUBCATEGORIES } from '../adapters/categories.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const INTERVAL = Number(process.env.RR_SYNC_INTERVAL_MINUTES || 30);
const STALE_AFTER = Number(process.env.RR_STALE_AFTER_MINUTES || 180);
const DISABLE_SCHEDULER = process.env.RR_DISABLE_SCHEDULER === '1';
const ADMIN_TOKEN = process.env.RR_ADMIN_TOKEN || '';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// --- API ---
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: getDbPath(), jsonMode: isJsonMode(), intervalMinutes: INTERVAL });
});

app.get('/api/published', (_req, res) => {
  try {
    const payload = buildPublishedPayload();
    const stale = isStale(payload.meta);
    res.json({ ...payload, meta: { ...payload.meta, stale_after_minutes: STALE_AFTER, is_stale: stale } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/records', (req, res) => {
  const payload = buildPublishedPayload();
  let records = payload.records;
  const { category, track, brand, year, q, powertrain } = req.query;
  if (category) records = records.filter((r) => r.category_id === category);
  if (track) records = records.filter((r) => r.track_id === track);
  if (brand) records = records.filter((r) => r.brand === brand);
  if (year) records = records.filter((r) => String(r.record_date).startsWith(String(year)));
  if (powertrain) {
    records = records.filter((r) => String(r.category_id).includes(`/${powertrain}/`));
  }
  if (q) {
    const needle = String(q).toLowerCase();
    records = records.filter(
      (r) =>
        String(r.vehicle_en).toLowerCase().includes(needle) ||
        String(r.driver_en || '').toLowerCase().includes(needle) ||
        String(r.brand).toLowerCase().includes(needle),
    );
  }
  res.json({ records, total: records.length, meta: payload.meta });
});

app.get('/api/categories', (_req, res) => {
  res.json({ tree: categoryTree(), subcategories: SUBCATEGORIES, rows: query('SELECT * FROM categories') });
});

app.get('/api/news', (_req, res) => {
  const payload = buildPublishedPayload();
  res.json({ items: payload.news_items, meta: payload.meta });
});

app.get('/api/sync/status', (_req, res) => {
  const runs = query('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1');
  const lastSuccess = get(
    `SELECT * FROM sync_runs WHERE status IN ('success','partial') ORDER BY id DESC LIMIT 1`,
  );
  const last = runs?.[0] || null;
  const now = Date.now();
  const lastSuccessAt = lastSuccess?.finished_at ? Date.parse(lastSuccess.finished_at) : null;
  const isStaleFlag = lastSuccessAt ? now - lastSuccessAt > STALE_AFTER * 60_000 : true;
  res.json({
    last_check_at: last?.finished_at || last?.started_at || null,
    last_success_at: lastSuccess?.finished_at || null,
    last_status: last?.status || 'unknown',
    data_version: lastSuccess?.data_version || last?.data_version || null,
    is_stale: isStaleFlag,
    stale_after_minutes: STALE_AFTER,
    interval_minutes: INTERVAL,
    scheduler_enabled: !DISABLE_SCHEDULER,
  });
});

function isStale(meta) {
  if (!meta?.last_success_at) return true;
  return Date.now() - Date.parse(meta.last_success_at) > STALE_AFTER * 60_000;
}

app.post('/api/admin/sync', async (req, res) => {
  if (ADMIN_TOKEN) {
    const auth = req.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  }
  const result = await runSync();
  res.status(result.ok ? 200 : 502).json(result);
});

// --- Static frontend ---
app.use(express.static(ROOT, { index: 'index.html', extensions: ['html'] }));

// SPA-ish routes
app.get('/records/:id', (_req, res) => {
  res.sendFile(join(ROOT, 'index.html'));
});
app.get('/compare', (_req, res) => {
  res.sendFile(join(ROOT, 'index.html'));
});

// --- Scheduler (runs even with zero visitors) ---
if (!DISABLE_SCHEDULER) {
  const expr = `*/${Math.max(1, INTERVAL)} * * * *`;
  cron.schedule(expr, () => {
    runSync().catch((err) => console.error('[sync]', err));
  });
  // kick one sync shortly after boot
  setTimeout(() => {
    runSync().catch((err) => console.error('[sync-boot]', err));
  }, 1500);
  console.log(`[scheduler] every ${INTERVAL} minute(s): ${expr}`);
}

app.listen(PORT, () => {
  console.log(`Ring Records listening on http://localhost:${PORT}`);
  console.log(`DB: ${getDbPath()} (jsonMode=${isJsonMode()})`);
});

function loadVersion() {
  const p = resolve(ROOT, 'package.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).version : '0';
}
void loadVersion;
