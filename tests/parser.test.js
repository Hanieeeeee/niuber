import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRecordsHtml, parseNewsHtml } from '../adapters/official-html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(resolve(__dirname, 'fixtures/records-sample.html'), 'utf8');
const newsFixture = readFileSync(resolve(__dirname, 'fixtures/news-sample.html'), 'utf8');

test('parse records sample: categories + rows + videos', () => {
  const { records, categories } = parseRecordsHtml(fixture);
  assert.ok(records.length >= 4);
  assert.ok(categories.length >= 3);
  const proto = records.find((r) => r.vehicle_en.includes('919'));
  assert.equal(proto.lap_time_ms, 319546);
  assert.ok(proto.video_url);
  const auto = records.find((r) => r.category_id.endsWith('autonomous-driving'));
  assert.equal(auto.driver_en, null);
  assert.equal(auto.lap_time_ms, 629483);
  // kit versions stay distinct identities
  const taycan = records.filter((r) => r.vehicle_en.includes('Taycan'));
  assert.ok(taycan.length >= 2);
  assert.notEqual(taycan[0].id, taycan[1].id);
});

test('parse news sample', () => {
  const { items } = parseNewsHtml(newsFixture);
  assert.ok(items.length >= 1);
  assert.match(items[0].source_url, /nuerburgring\.de\/news\//);
  assert.ok(items[0].title_en);
});
