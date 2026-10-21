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
import { restoreParked, takeOverIfStale, withStartLock } from './lane-lock.mjs';
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
