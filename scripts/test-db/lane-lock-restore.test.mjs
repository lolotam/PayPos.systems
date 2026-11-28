import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { createLockRoot, ownerOf, seedLock } from './lane-lock-fixtures.mjs';
import { restoreParked } from './lane-lock-restore.mjs';
import { restoreParked as reexportedRestoreParked } from './lane-lock.mjs';
import { ownStartMs } from './lane-process.mjs';

const { freshLock, cleanup } = createLockRoot();
after(() => cleanup());

const eperm = () => Object.assign(new Error('EPERM'), { code: 'EPERM' });

test('#505: lane-lock.mjs re-exports restoreParked, so the old importers keep working', () => {
  const lock = freshLock();
  const parked = `${lock}.stale-x`;
  seedLock(parked, { pid: process.pid, startedAt: ownStartMs(), token: 'parked' });
  // الاستيراد القديم كان من lane-lock.mjs، فبنستدعي النسخة المعادة التصدير وبنتأكد إنها بترجّع الـ lock زي ما كانت.
  assert.equal(reexportedRestoreParked(lock, parked), true);
  assert.equal(ownerOf(lock).token, 'parked');
  assert.equal(existsSync(parked), false);
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

test('#473: a failed owner move falls back to copying the owner back', (t) => {
  const lock = freshLock();
  const parked = `${lock}.stale-x`;
  seedLock(parked, { pid: process.pid, startedAt: ownStartMs(), token: 'parked' });
  const lines = [];
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')));
  const move = () => {
    throw eperm();
  };
  assert.equal(restoreParked(lock, parked, { move }), true);
  assert.equal(ownerOf(lock).token, 'parked');
  assert.equal(existsSync(parked), false);
});

test('#473: when the copy fails too, the empty lock dir is removed and the lock stays parked', (t) => {
  const lock = freshLock();
  const parked = `${lock}.stale-x`;
  // صاحب الـ owner.json مش قابل للقراءة (هو فولدر)، فالنسخة بتفشل زي ما النقل فشل.
  mkdirSync(join(parked, 'owner.json'), { recursive: true });
  const lines = [];
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')));
  const move = () => {
    throw eperm();
  };
  assert.equal(restoreParked(lock, parked, { move }), false);
  assert.equal(existsSync(lock), false);
  assert.equal(existsSync(parked), true);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes(parked));
});

test('#473: a failed restore never removes a lock dir that replaced ours', (t) => {
  const lock = freshLock();
  const parked = `${lock}.stale-x`;
  seedLock(parked, { pid: process.pid, startedAt: ownStartMs(), token: 'parked' });
  const lines = [];
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')));
  const move = () => {
    // الـ lock اتنقل بالـ rename (مش اتمسح)، ورقم الـ inode القديم لسه عايش والفولدر الجديد مختلف.
    renameSync(lock, `${lock}.moved`);
    mkdirSync(lock);
    throw eperm();
  };
  assert.equal(restoreParked(lock, parked, { move }), false);
  assert.equal(existsSync(lock), true);
  assert.deepEqual(readdirSync(lock), []);
  assert.equal(existsSync(parked), true);
});

test('#473: a copy that fails after creating owner.json leaves no partial file and releases the empty lock dir', (t) => {
  const lock = freshLock();
  const parked = `${lock}.stale-x`;
  seedLock(parked, { pid: process.pid, startedAt: ownStartMs(), token: 'parked' });
  const lines = [];
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')));
  const move = () => {
    throw eperm();
  };
  // الكتابة عملت الملف وفشلت بعد كده: لازم الجزء ده يتمسح وإلا الـ lock هيفضل مسدود من غير صاحب.
  const write = (fd) => {
    writeFileSync(fd, '{"tok');
    throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
  };
  assert.equal(restoreParked(lock, parked, { move, write }), false);
  assert.equal(existsSync(lock), false);
  assert.equal(existsSync(parked), true);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes(parked));
});

test('#473: a failed restore never removes a lock dir that got an owner meanwhile', (t) => {
  const lock = freshLock();
  const parked = `${lock}.stale-x`;
  seedLock(parked, { pid: process.pid, startedAt: ownStartMs(), token: 'parked' });
  const lines = [];
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')));
  const move = () => {
    // starter تاني مسك الفولدر وكتب صاحبه قبل ما النقل يفشل.
    writeFileSync(
      join(lock, 'owner.json'),
      JSON.stringify({ host: hostname(), pid: process.pid, startedAt: ownStartMs(), token: 'new' }),
    );
    throw eperm();
  };
  assert.equal(restoreParked(lock, parked, { move }), false);
  assert.equal(ownerOf(lock).token, 'new');
  assert.equal(existsSync(parked), true);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes(parked));
});

test('#473: a parked lock without owner.json still restores to an empty lock dir', () => {
  const lock = freshLock();
  const parked = `${lock}.stale-x`;
  mkdirSync(parked);
  assert.equal(restoreParked(lock, parked), true);
  assert.equal(existsSync(lock), true);
  assert.equal(existsSync(parked), false);
});
