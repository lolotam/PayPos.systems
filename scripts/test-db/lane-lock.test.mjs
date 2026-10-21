import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { LaneError } from './lane-error.mjs';
import {
  clearStaleGuard,
  inspect,
  releaseGuard,
  restoreParked,
  takeOverIfStale,
  withStartLock,
} from './lane-lock.mjs';
import { ownStartMs } from './lane-process.mjs';

const root = mkdtempSync(join(tmpdir(), 'pospay-lane-lock-'));
after(() => rmSync(root, { recursive: true, force: true }));

let count = 0;
const freshLock = () => join(mkdtempSync(join(root, `case-${++count}-`)), 'lock.d');

// pid لعملية خلصت فعلاً: الـ lock بتاعها ميت.
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

function seedLock(lock, owner) {
  mkdirSync(lock);
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ host: hostname(), ...owner }));
}

const ownerOf = (dir) => JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'));
const leftovers = (lock) =>
  readdirSync(join(lock, '..')).filter((name) => name !== 'lock.d' && name.startsWith('lock.d'));

test('two starts in one process never overlap', async () => {
  const lock = freshLock();
  const events = [];
  const run = (name) =>
    withStartLock(
      lock,
      async () => {
        events.push(`${name}:in`);
        await new Promise((resolve) => setTimeout(resolve, 300));
        events.push(`${name}:out`);
      },
      { waitMs: 60_000 },
    );
  await Promise.all([run('a'), run('b')]);
  assert.deepEqual(
    events.map((event) => event.split(':')[1]),
    ['in', 'out', 'in', 'out'],
  );
  assert.equal(existsSync(lock), false);
});

test('a lock whose owner process is gone is taken over and leaves nothing behind', async () => {
  const lock = freshLock();
  seedLock(lock, { pid: deadPid(), startedAt: ownStartMs(), token: 'dead' });
  assert.equal(await withStartLock(lock, () => 'ran', { waitMs: 30_000 }), 'ran');
  assert.equal(existsSync(lock), false);
  assert.deepEqual(leftovers(lock), []);
});

test('#450: a live pid with another start time is a reused pid, so the lock is taken over', async () => {
  const lock = freshLock();
  seedLock(lock, { pid: process.pid, startedAt: ownStartMs() - 3_600_000, token: 'reused' });
  assert.equal(await withStartLock(lock, () => 'ran', { waitMs: 30_000 }), 'ran');
  assert.deepEqual(leftovers(lock), []);
});

test('#450: a live pid with its own start time keeps the lock', async () => {
  const lock = freshLock();
  seedLock(lock, { pid: process.pid, startedAt: ownStartMs(), token: 'live' });
  await assert.rejects(
    withStartLock(lock, () => 'ran', { waitMs: 1_000 }),
    (error) => error instanceof LaneError && /another lane start holds/.test(error.message),
  );
  assert.equal(ownerOf(lock).token, 'live');
});

test('#449: a dead lock is not reaped while another takeover holds the guard', () => {
  const lock = freshLock();
  seedLock(lock, { pid: deadPid(), startedAt: ownStartMs(), token: 'dead' });
  const before = statSync(lock, { bigint: true }).ino;
  mkdirSync(`${lock}.takeover`);
  takeOverIfStale(lock);
  assert.equal(statSync(lock, { bigint: true }).ino, before);
  assert.equal(ownerOf(lock).token, 'dead');

  rmSync(`${lock}.takeover`, { recursive: true });
  takeOverIfStale(lock);
  assert.equal(existsSync(lock), false);
  assert.deepEqual(leftovers(lock), []);
});

test('#449: a guard left by a crashed takeover is cleared once it is old', () => {
  const lock = freshLock();
  seedLock(lock, { pid: deadPid(), startedAt: ownStartMs(), token: 'dead' });
  const guard = `${lock}.takeover`;
  mkdirSync(guard);
  const old = new Date(Date.now() - 5 * 60_000);
  utimesSync(guard, old, old);
  takeOverIfStale(lock);
  assert.equal(existsSync(guard), false);
  takeOverIfStale(lock);
  assert.equal(existsSync(lock), false);
  assert.deepEqual(leftovers(lock), []);
});

test('#449: a lock with no owner yet is never taken over before the age limit', async () => {
  const lock = freshLock();
  mkdirSync(lock);
  await assert.rejects(
    withStartLock(lock, () => 'ran', { waitMs: 800 }),
    LaneError,
  );
  assert.deepEqual(readdirSync(lock), []);
  assert.deepEqual(leftovers(lock), []);
});

test('#451: restoring a parked lock never replaces a lock dir created in the meantime', () => {
  const lock = freshLock();
  const parked = `${lock}.stale-x`;
  seedLock(parked, { pid: process.pid, startedAt: ownStartMs(), token: 'parked' });
  // starter تاني لسه عامل mkdir ومكتبش owner.json.
  mkdirSync(lock);
  const before = statSync(lock, { bigint: true }).ino;
  assert.equal(restoreParked(lock, parked), false);
  assert.equal(statSync(lock, { bigint: true }).ino, before);
  assert.deepEqual(readdirSync(lock), []);
  assert.equal(ownerOf(parked).token, 'parked');
});

test('#451: restoring a parked lock puts its owner back when the path is free', () => {
  const lock = freshLock();
  const parked = `${lock}.stale-x`;
  seedLock(parked, { pid: process.pid, startedAt: ownStartMs(), token: 'parked' });
  assert.equal(restoreParked(lock, parked), true);
  assert.equal(ownerOf(lock).token, 'parked');
  assert.equal(existsSync(parked), false);
});

const eperm = () => Object.assign(new Error('EPERM'), { code: 'EPERM' });

test('#473: a failed owner move removes the empty lock dir and leaves the lock parked', (t) => {
  const lock = freshLock();
  const parked = `${lock}.stale-x`;
  seedLock(parked, { pid: process.pid, startedAt: ownStartMs(), token: 'parked' });
  const lines = [];
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')));
  const move = () => {
    throw eperm();
  };
  assert.equal(restoreParked(lock, parked, { move }), false);
  assert.equal(existsSync(lock), false);
  assert.equal(ownerOf(parked).token, 'parked');
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes(parked));
});

test('#473: a failed owner move never removes a lock dir that replaced ours', (t) => {
  const lock = freshLock();
  const parked = `${lock}.stale-x`;
  seedLock(parked, { pid: process.pid, startedAt: ownStartMs(), token: 'parked' });
  t.mock.method(console, 'log', () => {});
  const move = () => {
    // الـ lock اتشال واتعمل تاني في نفس المكان (الـ inode اتغير).
    rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock);
    throw eperm();
  };
  assert.equal(restoreParked(lock, parked, { move }), false);
  assert.equal(existsSync(lock), true);
  assert.deepEqual(readdirSync(lock), []);
});

test('#473: a failed owner move never removes a lock dir that got an owner meanwhile', (t) => {
  const lock = freshLock();
  const parked = `${lock}.stale-x`;
  seedLock(parked, { pid: process.pid, startedAt: ownStartMs(), token: 'parked' });
  t.mock.method(console, 'log', () => {});
  const move = () => {
    // starter تاني مسك الفولدر وكتب صاحبه قبل ما النقل يفشل.
    writeFileSync(
      join(lock, 'owner.json'),
      JSON.stringify({ host: hostname(), pid: process.pid, startedAt: ownStartMs(), token: 'new' }),
    );
    throw eperm();
  };
  assert.equal(restoreParked(lock, parked, { move }), false);
  assert.equal(existsSync(lock), true);
  assert.equal(ownerOf(lock).token, 'new');
});

test('#473: a parked lock without owner.json still restores to an empty lock dir', () => {
  const lock = freshLock();
  const parked = `${lock}.stale-x`;
  mkdirSync(parked);
  assert.equal(restoreParked(lock, parked), true);
  assert.equal(existsSync(lock), true);
  assert.equal(existsSync(parked), false);
});

test('#449: starts racing over a dead lock enter one at a time and leave nothing behind', async () => {
  const lock = freshLock();
  seedLock(lock, { pid: deadPid(), startedAt: ownStartMs(), token: 'dead' });
  const inside = join(lock, '..', 'inside');
  const child = fileURLToPath(new URL('lane-lock.child.mjs', import.meta.url));
  const exits = await Promise.all(
    Array.from(
      { length: 4 },
      () =>
        new Promise((resolve) => {
          const run = spawn(process.execPath, [child, lock, inside], { stdio: 'inherit' });
          run.on('exit', resolve);
        }),
    ),
  );
  assert.deepEqual(exits, [0, 0, 0, 0]);
  assert.equal(existsSync(lock), false);
  assert.deepEqual(
    leftovers(lock).filter((name) => name !== 'inside'),
    [],
  );
});

function staleGuard(lock, token) {
  const guard = `${lock}.takeover`;
  mkdirSync(guard);
  writeFileSync(join(guard, 'owner.json'), JSON.stringify({ token }));
  const old = new Date(Date.now() - 5 * 60_000);
  utimesSync(guard, old, old);
  return guard;
}

test('#449: two contenders clearing one stale guard never remove the fresh guard that replaced it', () => {
  const lock = freshLock();
  const guard = staleGuard(lock, 'crashed');
  // الاتنين شافوا نفس الـ guard القديم؛ الأول شاله وعمل guard جديد قبل ما التاني يوصل.
  const seenByLate = inspect(guard);
  clearStaleGuard(guard);
  assert.equal(existsSync(guard), false);
  mkdirSync(guard);
  writeFileSync(join(guard, 'owner.json'), JSON.stringify({ token: 'fresh' }));
  clearStaleGuard(guard, seenByLate);
  assert.equal(ownerOf(guard).token, 'fresh');
  assert.deepEqual(
    leftovers(lock).filter((name) => name !== 'lock.d.takeover'),
    [],
  );
});

test('#449: a takeover whose guard was replaced does not release the new holder guard', () => {
  const lock = freshLock();
  const guard = staleGuard(lock, 'fresh');
  releaseGuard(guard, 'crashed');
  assert.equal(ownerOf(guard).token, 'fresh');
  releaseGuard(guard, 'fresh');
  assert.equal(existsSync(guard), false);
  assert.deepEqual(leftovers(lock), []);
});
