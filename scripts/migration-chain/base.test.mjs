import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkMigrationChain } from './check.mjs';

const rootId = '00000000-0000-0000-0000-000000000000';
const checkerPath = fileURLToPath(new URL('./check.mjs', import.meta.url));
const workflowPath = fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url));
const blob = 'packages/db/migrations/meta/_journal.json';
const trustedSha = 'a'.repeat(40);
const entries = [
  { idx: 0, tag: '0000_first' },
  { idx: 1, tag: '0001_second' },
  { idx: 2, tag: '0002_third' },
];
// هوية الـfixture في أمر git عشان ما نلمسش إعدادات المستخدم.
const user = ['-c', 'user.name=F', '-c', 'user.email=a@b.c', '-c', 'commit.gpgsign=false'];

function chainErrors(candidate, journal = { entries }) {
  const sql = candidate.map((entry) => `${entry.tag}.sql`);
  const snapshots = new Map(
    candidate.map((entry, position) => [
      entry.idx,
      { id: entry.tag, prevId: position ? candidate[position - 1].tag : rootId },
    ]),
  );
  return checkMigrationChain({ entries: candidate }, sql, snapshots, {
    journal,
    sha: trustedSha,
  });
}
function git(repository, args) {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8', shell: false }).trim();
}
function commit(repository, message) {
  git(repository, ['add', '-A']);
  git(repository, [...user, 'commit', '-m', message]);
  return git(repository, ['rev-parse', 'HEAD']);
}
function writeChain(repository, rows) {
  const directory = join(repository, 'packages/db/migrations');
  mkdirSync(join(directory, 'meta'), { recursive: true });
  writeFileSync(join(directory, 'meta/_journal.json'), JSON.stringify({ entries: rows }));
  for (const [position, entry] of rows.entries()) {
    writeFileSync(join(directory, `${entry.tag}.sql`), 'select 1;\n');
    const prev = position ? rows[position - 1].tag : rootId;
    const name = `${String(entry.idx).padStart(4, '0')}_snapshot.json`;
    writeFileSync(join(directory, 'meta', name), JSON.stringify({ id: entry.tag, prevId: prev }));
  }
}
// أول commit فيه الـchecker بس، فالأساس اللي قبله مفيهوش journal blob.
function makeRepository(rows = entries) {
  const root = mkdtempSync(join(tmpdir(), 'pospay-859-'));
  git(root, ['init', '-b', 'main']);
  mkdirSync(join(root, 'scripts/migration-chain'), { recursive: true });
  writeFileSync(join(root, 'scripts/migration-chain/check.mjs'), readFileSync(checkerPath, 'utf8'));
  commit(root, 'checker only');
  writeChain(root, rows);
  commit(root, 'migrations');
  return root;
}
// التنضيف بيمس الجذر المؤقت المملوك بس، وبحد فاصل عشان Temp ما يبلعش Temp-other.
function removeRepository(root) {
  const real = realpathSync(root);
  const prefix = `${realpathSync(tmpdir())}${sep}`;
  const fold = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  const owned =
    fold(real).startsWith(fold(prefix)) && basename(real).toLowerCase().startsWith('pospay-859-');
  if (!owned) {
    throw new Error(`refusing to remove a path outside the owned temporary root: ${real}`);
  }
  rmSync(real, { recursive: true, force: true });
}
function runChecker(root, args, env = {}, cwd = root) {
  const checker = join(root, 'scripts/migration-chain/check.mjs');
  const result = spawnSync(process.execPath, [checker, ...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, CI: '', GITHUB_ACTIONS: '', GITHUB_EVENT_NAME: '', ...env },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
function assertFails(result, expected) {
  assert.notEqual(result.status, 0, expected);
  assert.ok(result.stderr.includes(expected), `${expected}: ${result.stderr}`);
}
function owned(run) {
  const root = makeRepository();
  try {
    return run(root);
  } finally {
    removeRepository(root);
  }
}
function includes(list, expected) {
  assert.ok(
    list.some((error) => error.includes(expected)),
    `${expected}: ${list.join('\n')}`,
  );
}

let shared;
before(() => {
  shared = makeRepository();
});
after(() => removeRepository(shared));

test('trusted base keeps every idx and tag, including a historical gap', () => {
  assert.deepEqual(chainErrors(entries), []);
  assert.deepEqual(chainErrors([...entries, { idx: 3, tag: '0003_fourth' }]), []);
  const gap = [];
  for (let idx = 0; idx <= 120; idx += 1) {
    if (idx === 118 || idx === 119) continue;
    gap.push({ idx, tag: `${String(idx).padStart(4, '0')}_m` });
  }
  assert.deepEqual(chainErrors(gap, { entries: gap }), []);
  const hidden = chainErrors([
    entries[0],
    { idx: 1, tag: '0001_other' },
    { idx: 1, tag: '0001_second' },
    entries[2],
  ]);
  includes(hidden, 'actual 0001_other');
  includes(chainErrors(entries.slice(0, 2)), 'idx 2');
  includes(chainErrors(entries.slice(0, 2)), '0002_third');
  const internal = chainErrors([entries[0], entries[2]]);
  includes(internal, 'idx 1');
  includes(internal, '0001_second');
  includes(internal, 'expected 1, actual 2');
  const renamed = chainErrors([entries[0], { idx: 1, tag: '0001_renamed' }, entries[2]]);
  assert.equal(renamed.length, 1, renamed.join('\n'));
  assert.match(renamed[0], /idx 1: expected tag 0001_second, actual 0001_renamed/);
  assert.ok(renamed[0].includes(trustedSha));
  const malformed = [
    ['not-an-object', 'expected a JSON object'],
    [{}, 'expected nonempty entries'],
    [{ entries: [] }, 'expected nonempty entries'],
    [{ entries: [{ idx: -1, tag: '0000_first' }] }, 'nonnegative safe integer'],
    [{ entries: [{ idx: 1.5, tag: '0001_second' }] }, 'nonnegative safe integer'],
    [{ entries: [{ idx: 0, tag: '' }] }, 'nonempty string'],
    [
      {
        entries: [
          { idx: 0, tag: '0000_first' },
          { idx: 0, tag: '0000_other' },
        ],
      },
      'unique idx',
    ],
    [
      {
        entries: [
          { idx: 0, tag: '0000_first' },
          { idx: 2, tag: '0002_third' },
        ],
      },
      'expected 1, actual 2',
    ],
    [{ entries: [{ idx: 0, tag: '9999_first' }] }, 'expected prefix 0000_'],
  ];
  for (const [journal, expected] of malformed) includes(chainErrors(entries, journal), expected);
});

test('CLI names the resolved base and stays Git-free without --base', () => {
  const head = git(shared, ['rev-parse', 'HEAD']);
  const compared = runChecker(shared, ['--base', head], {}, tmpdir());
  assert.equal(compared.status, 0, compared.stderr);
  assert.ok(compared.stdout.includes(`Compared against merged history ${head}`), compared.stdout);
  const local = runChecker(shared, [], { PATH: '', Path: '' }, tmpdir());
  assert.equal(local.status, 0, local.stderr);
  assert.ok(local.stdout.includes('merged-history comparison was not requested'), local.stdout);
  assert.throws(() => removeRepository(tmpdir()), /owned temporary root/);
});

test('CLI rejects bad arguments, missing Git, missing objects and invalid JSON', () => {
  const head = git(shared, ['rev-parse', 'HEAD']);
  const cases = [
    [['--bogus'], {}, 'unknown argument --bogus'],
    [['--base', head, '--base', head], {}, 'repeated argument --base'],
    [['--base'], {}, 'missing value for --base'],
    [['--base', 'missing-ref'], {}, 'git rev-parse failed'],
    [['--base', head], { PATH: '', Path: '' }, 'git rev-parse failed'],
    [['--base', git(shared, ['rev-parse', 'HEAD~1'])], {}, 'expected a readable blob'],
  ];
  for (const [args, env, expected] of cases) assertFails(runChecker(shared, args, env), expected);
  owned((root) => {
    const good = git(root, ['rev-parse', 'HEAD']);
    writeFileSync(join(root, blob), '{ not json');
    const broken = commit(root, 'broken journal');
    git(root, ['checkout', good]);
    assertFails(runChecker(root, ['--base', broken]), 'expected valid JSON');
  });
});

test('CI requires a nonzero 40-hex base and pull_request or push', () => {
  const head = git(shared, ['rev-parse', 'HEAD']);
  const push = { CI: 'true', GITHUB_EVENT_NAME: 'push' };
  const cases = [
    [[], push, 'CI base SHA'],
    [['--base', 'abc'], push, 'CI base SHA'],
    [['--base', '0'.repeat(40)], push, 'CI base SHA'],
    [['--base', ' '], push, 'CI base SHA'],
    [['--base', head], { CI: 'true', GITHUB_EVENT_NAME: 'schedule' }, 'CI event'],
    [['--base', head], { GITHUB_ACTIONS: 'true' }, 'CI event'],
    [['--base', head], { CI: 'true' }, 'CI event'],
  ];
  for (const [args, env, expected] of cases) assertFails(runChecker(shared, args, env), expected);
});

test('pull_request requires two parents and the supplied base as the first', () => {
  owned((root) => {
    const base = git(root, ['rev-parse', 'HEAD']);
    git(root, ['checkout', '-b', 'feature']);
    writeFileSync(join(root, 'feature.txt'), 'feature\n');
    commit(root, 'feature');
    git(root, ['checkout', 'main']);
    git(root, [...user, 'merge', '--no-ff', 'feature', '-m', 'merge feature']);
    const context = { CI: 'true', GITHUB_EVENT_NAME: 'pull_request' };
    const valid = runChecker(root, ['--base', base], context);
    assert.equal(valid.status, 0, valid.stderr);
    assertFails(
      runChecker(root, ['--base', git(root, ['rev-parse', 'feature'])], context),
      'expected first parent',
    );
    git(root, ['checkout', base]);
    assertFails(runChecker(root, ['--base', base], context), 'expected two parents');
  });
});

test('a multi-commit push fails at event.before and passes at the wrong HEAD^', () => {
  owned((root) => {
    const before = git(root, ['rev-parse', 'HEAD']);
    rmSync(join(root, 'packages/db/migrations/0002_third.sql'));
    rmSync(join(root, 'packages/db/migrations/meta/0002_snapshot.json'));
    writeChain(root, entries.slice(0, 2));
    const afterDeletion = commit(root, 'drop the latest migration');
    writeFileSync(join(root, 'unrelated.txt'), 'unrelated\n');
    commit(root, 'unrelated change');
    const context = { CI: 'true', GITHUB_EVENT_NAME: 'push' };
    const rejected = runChecker(root, ['--base', before], context);
    assert.notEqual(rejected.status, 0);
    assert.ok(rejected.stderr.includes('0002_third'), rejected.stderr);
    assert.equal(runChecker(root, ['--base', afterDeletion], context).status, 0);
  });
});

test('a shallow repository is rejected even when the base blob exists', () => {
  const source = makeRepository();
  const clone = mkdtempSync(join(tmpdir(), 'pospay-859-clone'));
  try {
    const head = git(source, ['rev-parse', 'HEAD']);
    git(tmpdir(), ['clone', '--no-local', '--depth', '1', source, clone]);
    assert.equal(git(clone, ['rev-parse', '--is-shallow-repository']), 'true');
    git(clone, ['cat-file', '-e', `${head}:${blob}`]);
    assertFails(runChecker(clone, ['--base', head]), 'shallow repository');
  } finally {
    removeRepository(source);
    removeRepository(clone);
  }
});

test('the check job binds full history and the triggering event only', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const job = workflow.slice(
    workflow.indexOf('\n  check:\n'),
    workflow.indexOf('\n  api-tests:\n'),
  );
  const checkout = job.slice(
    job.indexOf('actions/checkout@v7'),
    job.indexOf('pnpm/action-setup@v6'),
  );
  assert.match(checkout, /fetch-depth:\s*0/);
  const step = job.slice(job.indexOf('- name: migration chain'), job.indexOf('- name: api:check'));
  const folded = step.replace(/\s+/g, ' ');
  assert.equal(
    folded.match(/\$\{\{.*?\}\}/)?.[0],
    "${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event_name == 'push' && github.event.before || '' }}",
  );
  assert.match(folded, /pnpm migration-chain:check --base "\$MIGRATION_CHAIN_BASE_SHA"/);
  assert.equal(/github\.sha|\bHEAD\b/.test(folded), false);
});
