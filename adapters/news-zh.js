/**
 * Optional Chinese news translations (本站译文).
 * Read from data/news-zh.yml (simple YAML subset) and applied during publish.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATH = resolve(__dirname, '..', 'data', 'news-zh.yml');

/**
 * Minimal YAML subset parser for:
 * translations:
 *   - id: slug
 *     title_zh: ...
 *     summary_zh: ...
 */
export function loadNewsZh() {
  if (!existsSync(PATH)) return new Map();
  const text = readFileSync(PATH, 'utf8');
  const map = new Map();
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const item = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (item) {
      current = { id: item[1].trim() };
      map.set(current.id, current);
      continue;
    }
    const kv = line.match(/^\s+(title_zh|summary_zh):\s*(.*)$/);
    if (kv && current) {
      current[kv[1]] = kv[2].trim();
    }
  }
  return map;
}

export function applyNewsZh(items) {
  const zh = loadNewsZh();
  return items.map((n) => {
    const t = zh.get(n.id);
    if (!t?.summary_zh && !t?.title_zh) return n;
    return {
      ...n,
      title_zh: t.title_zh || n.title_zh,
      summary_zh: t.summary_zh || n.summary_zh,
      summary_zh_is_site_translation: t.summary_zh ? 1 : 0,
    };
  });
}
