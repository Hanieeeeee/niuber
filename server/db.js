/**
 * SQLite persistence via node:sqlite (Node 22+).
 * Falls back to a JSON file store if node:sqlite is unavailable.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyNewsZh } from '../adapters/news-zh.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SCHEMA = readFileSync(resolve(ROOT, 'schema.sql'), 'utf8');

const dbPath = process.env.RR_DB_PATH
  ? resolve(process.cwd(), process.env.RR_DB_PATH)
  : resolve(ROOT, 'data', 'ring-records.db');

mkdirSync(dirname(dbPath), { recursive: true });

let DatabaseCtor = null;
try {
  const mod = await import('node:sqlite');
  DatabaseCtor = mod.DatabaseSync || mod.Database;
} catch {
  DatabaseCtor = null;
}

/** @type {any} */
let db = null;
let jsonMode = false;
const jsonPath = resolve(dirname(dbPath), 'store.json');

function loadJson() {
  if (!existsSync(jsonPath)) {
    return { tracks: [], categories: [], records: [], news_items: [], sync_runs: [], data_versions: [] };
  }
  return JSON.parse(readFileSync(jsonPath, 'utf8'));
}

function saveJson(data) {
  const tmp = `${jsonPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, jsonPath);
}

if (DatabaseCtor) {
  db = new DatabaseCtor(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // migrate columns added after first publish
  try { db.exec('ALTER TABLE records ADD COLUMN photo_url TEXT'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE news_items ADD COLUMN image_url TEXT'); } catch { /* exists */ }
} else {
  jsonMode = true;
  mkdirSync(dirname(jsonPath), { recursive: true });
  if (!existsSync(jsonPath)) saveJson(loadJson());
}

export function isJsonMode() {
  return jsonMode;
}

export function getDbPath() {
  return jsonMode ? jsonPath : dbPath;
}

function upsertSql(table, row, conflictCols) {
  const keys = Object.keys(row);
  const placeholders = keys.map(() => '?').join(',');
  const updates = keys
    .filter((k) => !conflictCols.includes(k))
    .map((k) => `${k}=excluded.${k}`)
    .join(',');
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})
    ON CONFLICT(${conflictCols.join(',')}) DO UPDATE SET ${updates || conflictCols.map((c) => `${c}=${c}`).join(',')}`;
  return { sql, values: keys.map((k) => row[k]) };
}

export function upsert(table, row, conflictCols) {
  if (jsonMode) {
    const data = loadJson();
    const list = data[table] || (data[table] = []);
    const idx = list.findIndex((r) => conflictCols.every((c) => r[c] === row[c]));
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...row, updated_at: new Date().toISOString() };
    } else {
      list.push({ ...row, created_at: row.created_at || new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    saveJson(data);
    return;
  }
  const { sql, values } = upsertSql(table, row, conflictCols);
  db.prepare(sql).run(...values);
}

export function exec(sql, params = []) {
  if (jsonMode) throw new Error('exec not supported in json mode');
  return db.prepare(sql).run(...params);
}

export function query(sql, params = []) {
  if (jsonMode) {
    // limited subset used by the app
    return jsonQuery(sql, params);
  }
  return db.prepare(sql).all(...params);
}

export function get(sql, params = []) {
  if (jsonMode) {
    const rows = jsonQuery(sql, params);
    return rows[0];
  }
  return db.prepare(sql).get(...params);
}

function jsonQuery(sql, params = []) {
  const data = loadJson();
  const s = sql.toLowerCase();
  if (s.includes('from sync_runs')) return [...(data.sync_runs || [])].sort((a, b) => (a.id < b.id ? 1 : -1));
  if (s.includes('from data_versions')) return [...(data.data_versions || [])];
  if (s.includes('from tracks')) return data.tracks || [];
  if (s.includes('from categories')) return data.categories || [];
  if (s.includes('from news_items')) {
    let rows = data.news_items || [];
    if (params.length && typeof params[0] === 'string' && s.includes('where')) {
      // unused simple path
    }
    return [...rows].sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
  }
  if (s.includes('from records')) {
    let rows = [...(data.records || [])];
    // very small filter support: category_id = ?
    const catMatch = sql.match(/category_id\s*=\s*\?/i);
    if (catMatch && params[0]) rows = rows.filter((r) => r.category_id === params[0]);
    rows.sort((a, b) => a.lap_time_ms - b.lap_time_ms);
    return rows;
  }
  return [];
}

export function startSyncRun() {
  const started = new Date().toISOString();
  if (jsonMode) {
    const data = loadJson();
    const id = (data.sync_runs?.length || 0) + 1;
    const row = { id, started_at: started, finished_at: null, status: 'running', records_seen: 0, news_seen: 0, error: null, data_version: null };
    data.sync_runs = data.sync_runs || [];
    data.sync_runs.push(row);
    saveJson(data);
    return id;
  }
  const info = db
    .prepare(`INSERT INTO sync_runs (started_at, status) VALUES (?, 'running')`)
    .run(started);
  return Number(info.lastInsertRowid);
}

export function finishSyncRun(id, patch) {
  const finished = new Date().toISOString();
  if (jsonMode) {
    const data = loadJson();
    const row = (data.sync_runs || []).find((r) => r.id === id);
    if (row) Object.assign(row, patch, { finished_at: finished });
    saveJson(data);
    return;
  }
  db.prepare(
    `UPDATE sync_runs SET finished_at=?, status=?, records_seen=?, news_seen=?, error=?, data_version=? WHERE id=?`,
  ).run(
    finished,
    patch.status,
    patch.records_seen ?? 0,
    patch.news_seen ?? 0,
    patch.error ?? null,
    patch.data_version ?? null,
    id,
  );
}

export function publishSnapshot(version, recordCount, newsCount) {
  const dir = resolve(ROOT, 'data', 'snapshots');
  mkdirSync(dir, { recursive: true });
  const snap = resolve(dir, `v-${version}.json`);
  const published = buildPublishedPayload();
  writeFileSync(snap, JSON.stringify(published, null, 2), 'utf8');
  // also write latest published bundle for static hosting / frontend
  const latest = resolve(ROOT, 'data', 'published.json');
  const tmp = `${latest}.tmp`;
  writeFileSync(tmp, JSON.stringify(published, null, 2), 'utf8');
  renameSync(tmp, latest);
  copyFileSync(snap, resolve(dir, 'latest.json'));

  upsert(
    'data_versions',
    {
      version,
      published_at: new Date().toISOString(),
      record_count: recordCount,
      news_count: newsCount,
      snapshot_path: snap,
    },
    ['version'],
  );
  return published;
}

export function buildPublishedPayload() {
  const tracks = query('SELECT * FROM tracks');
  const categories = query('SELECT * FROM categories');
  const records = query('SELECT * FROM records');
  let news_items = query('SELECT * FROM news_items');
  // optional site translations (always labelled)
  news_items = applyNewsZh(news_items);
  const lastRun = query('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1');
  const lastSuccess = query(
    `SELECT * FROM sync_runs WHERE status='success' OR status='partial' ORDER BY id DESC LIMIT 1`,
  );

  records.sort((a, b) => a.lap_time_ms - b.lap_time_ms);

  return {
    schema: 'ring-records/published@1',
    generated_at: new Date().toISOString(),
    disclaimer: {
      en: 'Independent archive citing official Nürburgring sources. Not affiliated with Nürburgring 1927 GmbH & Co. KG.',
      zh: '本站为引用纽伯格林官方来源的独立档案，与 Nürburgring 1927 GmbH & Co. KG 无隶属关系。',
    },
    tracks,
    categories,
    records,
    news_items: news_items.sort((a, b) => (a.published_at < b.published_at ? 1 : -1)),
    meta: {
      last_check_at: lastRun?.[0]?.finished_at || lastRun?.[0]?.started_at || null,
      last_success_at: lastSuccess?.[0]?.finished_at || null,
      last_status: lastRun?.[0]?.status || 'unknown',
      data_version: lastSuccess?.[0]?.data_version || lastRun?.[0]?.data_version || null,
    },
  };
}

export { ROOT };
