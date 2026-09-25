/**
 * Lap time parsing / formatting for official Nürburgring listings.
 * Official strings are inconsistent: "7:24,172" "7:29.81" "7:36:698" "06:40.835"
 */

/**
 * @param {string} raw
 * @returns {number} integer milliseconds
 */
export function parseLapTimeToMs(raw) {
  if (raw == null) throw new Error('empty lap time');
  let s = String(raw).trim().replace(/\s+/g, '');
  if (!s) throw new Error('empty lap time');

  // German decimal comma → dot
  s = s.replace(',', '.');

  // Typo form "7:36:698" → treat 2nd colon as decimal separator
  const twoColons = s.match(/^(\d{1,2}):(\d{1,2}):(\d{1,3})$/);
  if (twoColons) {
    s = `${twoColons[1]}:${twoColons[2]}.${twoColons[3]}`;
  }

  // mm:ss.SSS | m:ss.SS | m:ss.S | mm:ss
  const m = s.match(/^(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!m) throw new Error(`unrecognized lap time: ${raw}`);

  const minutes = Number(m[1]);
  const seconds = Number(m[2]);
  let frac = m[3] || '0';
  // normalize fractional to milliseconds (2 digits → x10, 1 digit → x100)
  if (frac.length === 1) frac = frac + '00';
  else if (frac.length === 2) frac = frac + '0';
  const ms = minutes * 60_000 + seconds * 1000 + Number(frac);

  if (seconds >= 60) throw new Error(`invalid seconds in lap time: ${raw}`);
  return ms;
}

/**
 * @param {number} ms
 * @returns {string} mm:ss.SSS
 */
export function formatLapTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) throw new Error('invalid ms');
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * @param {string} raw DD.MM.YYYY
 * @returns {string} YYYY-MM-DD
 */
export function parseOfficialDate(raw) {
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) throw new Error(`unrecognized date: ${raw}`);
  const [_, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Best-effort brand from official vehicle string. Never invents brands not in the name.
 * @param {string} vehicle
 * @returns {string}
 */
export function extractBrand(vehicle) {
  const v = String(vehicle || '').trim();
  const multi = [
    'Mercedes-AMG',
    'Lynk & Co',
    'Porsche',
    'Volkswagen',
    'VW',
    'BMW',
    'Audi',
    'Honda',
    'Renault',
    'Jaguar',
    'Tesla',
    'Xiaomi',
    'YANGWANG',
    'Rimac',
    'Chevrolet',
    'Lotus',
    'Ford',
    'FORD',
    'Golf', // Golf GTI listed without VW prefix in one row
  ];
  for (const b of multi) {
    if (v.toLowerCase().startsWith(b.toLowerCase())) {
      return b === 'FORD' ? 'Ford' : b === 'Golf' ? 'Volkswagen' : b;
    }
  }
  const first = v.split(/\s+/)[0] || v;
  return first;
}
