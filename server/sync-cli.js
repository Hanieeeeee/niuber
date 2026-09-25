#!/usr/bin/env node
/** One-shot sync CLI: `npm run sync` */
import { runSync } from './sync.js';

const result = await runSync();
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
