import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATUSES = new Set(['done', 'in_progress', 'not_started']);

/**
 * Walks the whole roadmap and returns every object that carries `code` and a string `status`
 * (phases, gates, tasks, track items, partner requests).
 */
export function collectRows(node, rows = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectRows(child, rows);
  } else if (node && typeof node === 'object') {
    if (typeof node.code === 'string' && typeof node.status === 'string') rows.push(node);
    for (const child of Object.values(node)) collectRows(child, rows);
  }
  return rows;
}

/**
 * Applies `[{ code, status, ref? }]` to the roadmap in place and bumps `updated`.
 * Throws before changing anything when a code is unknown or a status is not one of the known three.
 */
export function applyUpdates(roadmap, updates, today) {
  const rows = collectRows(roadmap);
  for (const update of updates) {
    if (!STATUSES.has(update.status))
      throw new Error(`unknown status "${update.status}" for ${update.code}`);
    if (!rows.some((row) => row.code === update.code))
      throw new Error(`no roadmap row with code ${update.code}`);
  }
  for (const update of updates) {
    for (const row of rows.filter((candidate) => candidate.code === update.code)) {
      row.status = update.status;
      if (update.ref !== undefined) row.ref = update.ref;
    }
  }
  roadmap.updated = today;
  return roadmap;
}

function main(argv) {
  const [roadmapPath, updatesPath, today = new Date().toISOString().slice(0, 10)] = argv;
  if (!roadmapPath || !updatesPath) {
    console.error(
      'usage: node scripts/roadmap/set-status.mjs <roadmap.json> <updates.json> [YYYY-MM-DD]',
    );
    process.exit(2);
  }
  const source = readFileSync(roadmapPath, 'utf8');
  const roadmap = applyUpdates(
    JSON.parse(source),
    JSON.parse(readFileSync(updatesPath, 'utf8')),
    today,
  );
  const indent = source.trimEnd().includes('\n') ? 2 : 0;
  writeFileSync(roadmapPath, `${JSON.stringify(roadmap, null, indent)}\n`);
  console.log(`roadmap updated (${today})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
