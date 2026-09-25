-- Ring Records — persistent schema (SQLite / node:sqlite)
-- Source of truth for official Nürburgring record listings.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tracks (
  id            TEXT PRIMARY KEY,          -- e.g. nordschleife, grand_prix
  name_en       TEXT NOT NULL,
  name_zh       TEXT NOT NULL,
  distance_km   REAL NOT NULL,             -- 20.832 | 5.148
  timing_key    TEXT NOT NULL,             -- isolates non-comparable timing regimes
  source_url    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id            TEXT PRIMARY KEY,          -- stable slug: nordschleife/combustion/sports-cars
  track_id      TEXT NOT NULL REFERENCES tracks(id),
  parent_id     TEXT REFERENCES categories(id),
  group_en      TEXT NOT NULL,             -- COMBUSTION & HYBRID VEHICLES | ELECTRIC VEHICLES | ...
  group_zh      TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  name_zh       TEXT NOT NULL,
  name_official TEXT NOT NULL,             -- verbatim official label
  sort_order    INTEGER NOT NULL DEFAULT 0,
  source_url    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS records (
  id                TEXT PRIMARY KEY,      -- hash(track|category|vehicle|time_ms|date)
  track_id          TEXT NOT NULL REFERENCES tracks(id),
  category_id       TEXT NOT NULL REFERENCES categories(id),
  vehicle_en        TEXT NOT NULL,         -- full official model + kit/package
  vehicle_zh        TEXT,                  -- optional reliable Chinese name
  brand             TEXT NOT NULL,
  driver_en         TEXT,                  -- NULL when official table has no driver (autonomous)
  driver_zh         TEXT,
  lap_time_raw      TEXT NOT NULL,         -- verbatim official string
  lap_time_ms       INTEGER NOT NULL,      -- integer milliseconds for sort
  lap_time_display  TEXT NOT NULL,         -- mm:ss.SSS
  record_date       TEXT NOT NULL,         -- ISO date YYYY-MM-DD
  record_date_raw   TEXT NOT NULL,         -- DD.MM.YYYY
  video_url         TEXT,
  photo_url         TEXT,                  -- official still only (nuerburgring / their CDN)
  source_url        TEXT NOT NULL,
  official_note     TEXT,                  -- free text from official when available
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_records_identity
  ON records(track_id, category_id, vehicle_en, lap_time_ms, record_date);

CREATE INDEX IF NOT EXISTS ix_records_sort ON records(lap_time_ms);
CREATE INDEX IF NOT EXISTS ix_records_brand ON records(brand);
CREATE INDEX IF NOT EXISTS ix_records_year ON records(record_date);

CREATE TABLE IF NOT EXISTS news_items (
  id            TEXT PRIMARY KEY,          -- slug from official URL
  title_en      TEXT NOT NULL,
  title_zh      TEXT,                      -- 本站译文 title if provided
  summary_en    TEXT NOT NULL,
  summary_zh    TEXT,
  summary_zh_is_site_translation INTEGER NOT NULL DEFAULT 0,
  published_at  TEXT NOT NULL,             -- ISO date
  source_url    TEXT NOT NULL,
  image_url     TEXT,                      -- official listing/article image
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  status            TEXT NOT NULL,         -- running | success | failed | partial
  records_seen      INTEGER NOT NULL DEFAULT 0,
  news_seen         INTEGER NOT NULL DEFAULT 0,
  error             TEXT,
  data_version      TEXT,                  -- content hash of published batch
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS data_versions (
  version           TEXT PRIMARY KEY,      -- content hash
  published_at      TEXT NOT NULL,
  record_count      INTEGER NOT NULL,
  news_count        INTEGER NOT NULL,
  snapshot_path     TEXT
);
