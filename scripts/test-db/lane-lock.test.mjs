import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { LaneError } from './lane-error.mjs';
import { createLockRoot, ownerOf, seedLock } from './lane-lock-fixtures.mjs';
import {
  clearStaleGuard,
  inspect,
  releaseGuard,
  takeOverIfStale,
  withStartLock,
} from './lane-lock.mjs';
import { ownStartMs } from './lane-process.mjs';

const { freshLock, cleanup } = createLockRoot();
after(() => cleanup());

// pid لعملية خلصت فعلاً: الـ lock بتاعها ميت.
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

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
