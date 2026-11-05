/*
 * حجز الأرقام في PP-69.9 يمنع تكرار أسماء الملفات، لكنه لا يمنع تعارض سطر journal
 * أو prevId يرجع خطوتين للخلف، كما حدث بين #844 و#845؛ لذلك نفحص السلسلة قبل الدمج.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const historicalGaps = new Set([129, 135, 190, 205]);
// لم تُدمج 0118 و0119 مطلقًا؛ الاستثناء ثابت حتى لا نعيد كتابة migrations المدمجة.
const historicalIdxGaps = Object.freeze({ 117: 120 });
const number = (idx) => String(idx).padStart(4, '0');
const snapshotFile = (idx) => `meta/${number(idx)}_snapshot.json`;

export function checkMigrationChain(journal, sqlFiles, snapshots) {
  const errors = [];
  const sql = new Set(sqlFiles);
  const tags = new Set(journal.entries.map((entry) => entry.tag));
  for (const [position, entry] of journal.entries.entries()) {
    const previousIdx = journal.entries[position - 1]?.idx;
    const expectedIdx = position === 0 ? 0 : previousIdx + 1;
    const historicalGap = historicalIdxGaps[previousIdx] === entry.idx;
    if (entry.idx !== expectedIdx && !historicalGap) {
      errors.push(
        `meta/_journal.json entries[${position}].idx: expected ${expectedIdx}, actual ${entry.idx}`,
      );
    }
    const prefix = number(entry.idx);
    if (!entry.tag.startsWith(`${prefix}_`)) {
      errors.push(
        `meta/_journal.json tag ${entry.tag}: expected prefix ${prefix}_, actual tag ${entry.tag}`,
      );
    }
    if (!sql.has(`${entry.tag}.sql`)) {
      errors.push(`${entry.tag}.sql: expected SQL file for journal tag, actual missing`);
    }
    const latest = position === journal.entries.length - 1;
    if ((!historicalGaps.has(entry.idx) || latest) && !snapshots.has(entry.idx)) {
      errors.push(
        `${snapshotFile(entry.idx)}: expected snapshot for journal entry, actual missing`,
      );
    }
  }
  for (const file of sqlFiles.filter((name) => name.endsWith('.sql'))) {
    if (!tags.has(file.slice(0, -4))) {
      errors.push(`${file}: expected journal entry, actual missing`);
    }
  }
  const indexes = new Set(journal.entries.map((entry) => entry.idx));
  for (const idx of snapshots.keys()) {
    if (!indexes.has(idx)) {
      errors.push(
        `${snapshotFile(idx)}: expected journal entry for snapshot index ${idx}, actual missing`,
      );
    }
  }
  return [...errors, ...checkSnapshots(snapshots)];
}

function checkSnapshots(snapshots) {
  const errors = [];
  const ids = new Map();
  const rootId = '00000000-0000-0000-0000-000000000000';
  let previous;
  for (const [idx, snapshot] of [...snapshots].sort(([a], [b]) => a - b)) {
    const file = snapshotFile(idx);
    const valid = (value) => typeof value === 'string' && value.trim().length > 0;
    for (const field of ['id', 'prevId']) {
      if (!valid(snapshot?.[field])) {
        errors.push(
          `${file} ${field}: expected non-empty string, actual ${JSON.stringify(snapshot?.[field])}`,
        );
      }
    }
    if (valid(snapshot?.id) && ids.has(snapshot.id)) {
      errors.push(
        `${file} id: expected unique id, actual ${snapshot.id} also in ${ids.get(snapshot.id)}`,
      );
    }
    if (valid(snapshot?.id)) ids.set(snapshot.id, file);
    if (!previous && snapshot?.prevId !== rootId) {
      errors.push(`${file} prevId: expected ${rootId} (root), actual ${snapshot?.prevId}`);
    }
    if (
      previous &&
      valid(snapshot?.prevId) &&
      valid(previous.id) &&
      snapshot.prevId !== previous.id
    ) {
      errors.push(
        `${file} prevId: expected ${previous.id} (${previous.file} id), actual ${snapshot.prevId}`,
      );
    }
    previous = { id: snapshot?.id, file };
  }
  return errors;
}

export function readMigrationChain(directory) {
  const json = (path) => JSON.parse(readFileSync(resolve(directory, path), 'utf8'));
  const snapshots = new Map(
    readdirSync(resolve(directory, 'meta'))
      .filter((name) => /^\d{4}_snapshot\.json$/.test(name))
      .map((name) => [Number(name.slice(0, 4)), json(`meta/${name}`)]),
  );
  return [json('meta/_journal.json'), readdirSync(directory), snapshots];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const directory = fileURLToPath(new URL('../../packages/db/migrations/', import.meta.url));
    const errors = checkMigrationChain(...readMigrationChain(directory));
    for (const error of errors) console.error(error);
    if (errors.length) process.exitCode = 1;
    else console.log('Migration journal and snapshot chain are valid.');
  } catch (error) {
    console.error(`Migration chain: expected readable migration files, actual ${error.message}`);
    process.exitCode = 1;
  }
}
