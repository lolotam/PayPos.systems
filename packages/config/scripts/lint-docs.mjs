#!/usr/bin/env node
/**
 * `pnpm lint:docs` — the comment rules ESLint cannot express (CLAUDE.md §3.1):
 *   1. closing comments in JSX ({/* end ... *\/}, {/* /card *\/})
 *   2. the three banned debt markers anywhere in source (CLAUDE.md §3.1)
 *   3. commented-out code
 *   4. a JSDoc block in domain/**, ports/** or events/published.ts written without Arabic
 * TODO is reported as a warning and never fails the build.
 * JSDoc coverage itself is enforced by eslint-plugin-jsdoc inside `pnpm lint`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['apps', 'packages'];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  'generated',
  'migrations',
]);
const EXTENSIONS = /\.(ts|tsx|js|mjs|cjs)$/;
const SELF = 'packages/config/scripts/lint-docs.mjs';

const CHECKS = [
  { id: 'closing-comment', level: 'error', re: /\{\/\*\s*(end\b|\/)/i, only: /\.tsx$/ },
  {
    id: 'banned-marker',
    level: 'error',
    re: new RegExp('/[/*].*\\b(' + ['FIX' + 'ME', 'HA' + 'CK', 'X' + 'XX'].join('|') + ')\\b'),
  },
  {
    id: 'commented-out-code',
    level: 'error',
    re: /^\s*\/\/\s*(import |export |const |let |var |return\b|if \(|for \(|await |[\w.]+\(.*\);\s*$)/,
  },
  { id: 'todo', level: 'warn', re: /\/[/*].*\bTODO\b/ },
];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTENSIONS.test(name)) yield full;
  }
}

let errors = 0;
let warnings = 0;

const ARABIC_REQUIRED = /(^|\/)(domain|ports)\/.*\.ts$|(^|\/)events\/published\.ts$/;
// A letter of the Arabic script — digits (١) and punctuation (،) do not count as prose.
const ARABIC_LETTER = /(?=\p{Script=Arabic})\p{L}/u;

// CLAUDE.md §3.1 — the explanation is in Arabic. A block that has a description but no
// Arabic letter at all was written in the wrong language.
function checkArabicJsdoc(rel, source) {
  if (!ARABIC_REQUIRED.test(rel) || /\.(spec|test)\.ts$/.test(rel)) return;
  const blocks = source.matchAll(/\/\*\*([\s\S]*?)\*\//g);
  for (const m of blocks) {
    const body = m[1].replace(/^\s*\*\s?/gm, '').trim();
    if (body.length === 0 || ARABIC_LETTER.test(body)) continue;
    const line = source.slice(0, m.index).split('\n').length;
    console.log(`error  ${rel}:${line}  [jsdoc-not-arabic]  ${body.split('\n')[0].slice(0, 80)}`);
    errors++;
  }
}

for (const base of SCAN_DIRS) {
  for (const file of walk(join(ROOT, base))) {
    const rel = relative(ROOT, file).replaceAll('\\', '/');
    if (rel === SELF) continue;
    const source = readFileSync(file, 'utf8');
    checkArabicJsdoc(rel, source);
    source.split('\n').forEach((line, i) => {
      for (const check of CHECKS) {
        if (check.only && !check.only.test(rel)) continue;
        if (!check.re.test(line)) continue;
        const tag = check.level === 'error' ? 'error' : 'warn ';
        console.log(`${tag}  ${rel}:${i + 1}  [${check.id}]  ${line.trim()}`);
        if (check.level === 'error') errors++;
        else warnings++;
      }
    });
  }
}

console.log(`\nlint:docs — ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors > 0 ? 1 : 0);
