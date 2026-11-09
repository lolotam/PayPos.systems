/*
 * حجز الأرقام في PP-69.9 يمنع تكرار أسماء الملفات، لكنه لا يمنع تعارض سطر journal
 * أو prevId يرجع خطوتين للخلف، كما حدث بين #844 و#845؛ لذلك نفحص السلسلة قبل الدمج.
 * #859: المقارنة بأساس merged موثوق بتغطي حذف سطر مدمج أو تبديل تاج نفس الـidx
 * لما يتنسق مع SQL والـsnapshot بتوعه، ففحص الاتساق لوحده مش كافي.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const historicalGaps = new Set([129, 135, 190, 205]);
// لم تُدمج 0118 و0119 مطلقًا؛ الاستثناء ثابت حتى لا نعيد كتابة migrations المدمجة.
const historicalIdxGaps = Object.freeze({ 117: 120 });
const number = (idx) => String(idx).padStart(4, '0');
const snapshotFile = (idx) => `meta/${number(idx)}_snapshot.json`;
const journalPath = 'packages/db/migrations/meta/_journal.json';
// المسارات مثبتة على مكان الملف نفسه، فالمرشح بيتقرأ من المستودع نفسه مش من cwd المستدعي.
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const migrationsDirectory = fileURLToPath(
  new URL('../../packages/db/migrations/', import.meta.url),
);

export function checkMigrationChain(journal, sqlFiles, snapshots, base) {
  const errors = [];
  const sql = new Set(sqlFiles);
  const entries = Array.isArray(journal?.entries) ? journal.entries : [];
  // تاريخ فاضي مش حالة سليمة: الـmigrations المدمجة ما بتتشالش كلها.
  if (entries.length === 0) {
    errors.push('meta/_journal.json entries: expected at least one journal entry, actual 0');
  }
  const tags = new Set(entries.map((entry) => entry.tag));
  for (const [position, entry] of entries.entries()) {
    const previousIdx = entries[position - 1]?.idx;
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
    const latest = position === entries.length - 1;
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
  const indexes = new Set(entries.map((entry) => entry.idx));
  for (const idx of snapshots.keys()) {
    if (!indexes.has(idx)) {
      errors.push(
        `${snapshotFile(idx)}: expected journal entry for snapshot index ${idx}, actual missing`,
      );
    }
  }
  const baseErrors = checkBaseIdentity(entries, base);
  return [...errors, ...checkSnapshots(snapshots), ...baseErrors];
}

// يقارن المرشح بأساس merged موثوق: كل idx في الأساس لازم يفضل موجود بنفس التاج.
// شكل الأساس بيتفحص قبل المقارنة، وتشخيصات الاتساق بتفضل هي المرجع فالمقارنة ما بتلغيهاش.
// الرابع اختياري `{ journal, sha }`: التشخيص يسمي الـSHA من غير معامل خامس.
function checkBaseIdentity(candidateEntries, base) {
  if (base === undefined) return [];
  const baseJournal = base.journal;
  const prefix = `${journalPath} base ${base.sha ?? 'trusted base'}`;
  if (!baseJournal || typeof baseJournal !== 'object' || Array.isArray(baseJournal)) {
    return [`${prefix}: expected a JSON object`];
  }
  const baseEntries = baseJournal.entries;
  if (!Array.isArray(baseEntries) || baseEntries.length === 0) {
    return [`${prefix} entries: expected nonempty entries`];
  }
  const problems = [];
  const seen = new Set();
  for (const [position, entry] of baseEntries.entries()) {
    if (!Number.isSafeInteger(entry?.idx) || entry.idx < 0) {
      problems.push(`entries[${position}].idx: expected a nonnegative safe integer`);
      continue;
    }
    if (typeof entry.tag !== 'string' || entry.tag.length === 0) {
      problems.push(`entries[${position}].tag: expected a nonempty string`);
      continue;
    }
    if (seen.has(entry.idx)) {
      problems.push(`entries[${position}].idx: expected a unique idx, actual ${entry.idx}`);
      continue;
    }
    seen.add(entry.idx);
    const previousIdx = baseEntries[position - 1]?.idx;
    const expectedIdx = position === 0 ? 0 : previousIdx + 1;
    if (entry.idx !== expectedIdx && historicalIdxGaps[previousIdx] !== entry.idx) {
      problems.push(`entries[${position}].idx: expected ${expectedIdx}, actual ${entry.idx}`);
    }
    if (!entry.tag.startsWith(`${number(entry.idx)}_`)) {
      problems.push(`entries[${position}].tag: expected prefix ${number(entry.idx)}_`);
    }
  }
  if (problems.length) return problems.map((problem) => `${prefix}: ${problem}`);
  // أول ظهور للـidx هو المرجع: التكرار ما يقدرش يخفي أول تاج من تشخيصات الاتساق.
  const candidate = new Map();
  for (const entry of candidateEntries) {
    if (!candidate.has(entry.idx)) candidate.set(entry.idx, entry.tag);
  }
  const errors = [];
  for (const entry of baseEntries) {
    const actual = candidate.get(entry.idx);
    if (actual === undefined) {
      errors.push(`${prefix} idx ${entry.idx}: expected tag ${entry.tag}, actual missing`);
    } else if (actual !== entry.tag) {
      errors.push(`${prefix} idx ${entry.idx}: expected tag ${entry.tag}, actual ${actual}`);
    }
  }
  return errors;
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

// فشل صريح في الوسائط أو الأساس: بيتعرض برسالته هو مش برسالة الملفات العامة.
class CheckFailure extends Error {}

function parseArguments(argv) {
  const options = { base: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument !== '--base') throw new CheckFailure(`unknown argument ${argument}`);
    if (options.base !== undefined) throw new CheckFailure('repeated argument --base');
    if (value === undefined || value.startsWith('--'))
      throw new CheckFailure('missing value for --base');
    options.base = value;
    index += 1;
  }
  return options;
}

// مصفوفة وسائط وshell مقفول: المرجع والمسار ما بيتدخلوش في نص أوامر.
function git(repository, args) {
  try {
    return execFileSync('git', args, { cwd: repository, encoding: 'utf8', shell: false }).trim();
  } catch (error) {
    throw new CheckFailure(
      `git ${args[0]} failed: ${String(error.stderr ?? error.message).trim()}`,
    );
  }
}

// بيحمّل الأساس: بيتأكد من حدث CI وشكل الـSHA، وبيحلّ المرجع مرة واحدة،
// وبيقرأ journal نفس الـSHA بالظبط. أي فشل هنا بوقف الفحص صريح من غير fallback.
function loadBase(repository, ref, isCi) {
  const event = (process.env.GITHUB_EVENT_NAME ?? '').trim();
  if (isCi) {
    if (event !== 'pull_request' && event !== 'push') {
      throw new CheckFailure(
        `CI event: expected pull_request or push, actual ${event || 'missing'}`,
      );
    }
    if (!ref || !/^[0-9a-f]{40}$/.test(ref) || /^0+$/.test(ref)) {
      throw new CheckFailure(
        `CI base SHA: expected a nonzero 40-hex SHA, actual ${ref || 'missing'}`,
      );
    }
  }
  // المستودع السطحي مش دليل إن الأساس موجود؛ المقارنة كلها بتفشل صريح بدل ما تنزل تلقائي.
  if (git(repository, ['rev-parse', '--is-shallow-repository']) === 'true') {
    throw new CheckFailure('shallow repository: base comparison needs the full history');
  }
  const commit = git(repository, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new CheckFailure(`base ref ${ref}: expected a commit SHA`);
  let journal;
  try {
    const blob = `${commit}:${journalPath}`;
    journal = JSON.parse(
      execFileSync('git', ['show', blob], { cwd: repository, encoding: 'utf8', shell: false }),
    );
  } catch (error) {
    const detail =
      error instanceof SyntaxError ? 'expected valid JSON' : 'expected a readable blob';
    throw new CheckFailure(`base journal at ${commit}: ${detail}`);
  }
  // في PR الـHEAD merge commit بأبوين؛ لازم الأب الأول هو SHA الأساس المرسل من الحدث.
  if (isCi && event === 'pull_request') {
    const parents = git(repository, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/);
    if (parents.length !== 3) {
      throw new CheckFailure(
        `pull_request base: expected two parents on HEAD, actual ${parents.length - 1}`,
      );
    }
    if (parents[1] !== ref) {
      throw new CheckFailure(
        `pull_request base: expected first parent ${ref}, actual ${parents[1]}`,
      );
    }
  }
  return { commit, journal };
}

function runCheck() {
  const options = parseArguments(process.argv.slice(2));
  const isCi =
    (process.env.CI ?? '').trim().toLowerCase() === 'true' ||
    (process.env.GITHUB_ACTIONS ?? '').trim().toLowerCase() === 'true';
  const [journal, sqlFiles, snapshots] = readMigrationChain(migrationsDirectory);
  let baseJournal;
  let resolved;
  if (options.base !== undefined || isCi) {
    const base = loadBase(repositoryRoot, options.base, isCi);
    resolved = base.commit;
    baseJournal = base.journal;
  }
  const trusted = resolved === undefined ? undefined : { journal: baseJournal, sha: resolved };
  const errors = checkMigrationChain(journal, sqlFiles, snapshots, trusted);
  for (const error of errors) console.error(error);
  if (errors.length) {
    process.exitCode = 1;
    return;
  }
  const compared = resolved
    ? `Compared against merged history ${resolved}.`
    : 'Consistency only: merged-history comparison was not requested.';
  console.log(`Migration journal and snapshot chain are valid. ${compared}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCheck();
  } catch (error) {
    const detail =
      error instanceof CheckFailure
        ? error.message
        : `expected readable migration files, actual ${error.message}`;
    console.error(`Migration chain: ${detail}`);
    process.exitCode = 1;
  }
}
