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
