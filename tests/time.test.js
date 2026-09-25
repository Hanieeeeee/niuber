import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLapTimeToMs, formatLapTime, parseOfficialDate, extractBrand } from '../adapters/time.js';

test('parse mixed official lap time formats', () => {
  assert.equal(parseLapTimeToMs('5:19.546'), 319546);
  assert.equal(parseLapTimeToMs('7:24,172'), 444172);
  assert.equal(parseLapTimeToMs('7:29.81'), 449810);
  assert.equal(parseLapTimeToMs('7:36:698'), 456698);
  assert.equal(parseLapTimeToMs('06:40.835'), 400835);
  assert.equal(parseLapTimeToMs('7:54.40'), 474400);
  assert.equal(parseLapTimeToMs('1:56.096'), 116096);
  assert.equal(parseLapTimeToMs('10:29.483'), 629483);
});

test('format always mm:ss.SSS', () => {
  assert.equal(formatLapTime(319546), '05:19.546');
  assert.equal(formatLapTime(449810), '07:29.810');
});

test('parse official date', () => {
  assert.equal(parseOfficialDate('29.06.2018'), '2018-06-29');
  assert.equal(parseOfficialDate('1.4.2026'), '2026-04-01');
});

test('brand extraction keeps official marketing names', () => {
  assert.equal(extractBrand('Mercedes-AMG GT Black Series'), 'Mercedes-AMG');
  assert.equal(extractBrand('Porsche 911 GT3 RS Manthey Kit'), 'Porsche');
  assert.equal(extractBrand('Xiaomi SU7 Ultra Prototype'), 'Xiaomi');
  assert.equal(extractBrand('Golf GTI EDITION 50'), 'Volkswagen');
  assert.equal(extractBrand('YANGWANG U9 Xtreme'), 'YANGWANG');
});
