// الـ start lock المشترك بين كل الـ worktrees: اختيار البورت و docker run بيحصلوا تحته بس،
// عشان اتنين `up` في نفس اللحظة ميختاروش نفس البورت.
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

import { fail } from './lane-error.mjs';

const WAIT_MS = 120_000;
// docker run ممكن ياخد دقايق في pull الـ image، فالعمر لوحده مش دليل إن صاحب الـ lock مات إلا بعد مدة طويلة.
const STALE_MS = 15 * 60_000;

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function ageOf(path) {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function parseOwner(text) {
  try {
    return JSON.parse(text);
  } catch {
    // الملف اتعمل ولسه متكتبش فيه: عمره بس اللي يحكم عليه.
    return undefined;
  }
}

function ownerAlive(owner) {
  if (owner?.host !== hostname() || !Number.isInteger(owner?.pid)) return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// الـ rename عملية ذرية: اللي يكسبها بس هو اللي يمسح. ولو طلع إن اللي اتنقل مش هو الـ lock اللي حكمنا عليه
// (حد عمل lock جديد في النص) بنرجّعه مكانه بـ link، اللي بيفشل لو المكان اتاخد تاني.
function takeOverIfStale(lock) {
  const seen = readText(lock);
  if (seen === undefined) return;
  const owner = parseOwner(seen);
  const dead = owner !== undefined && !ownerAlive(owner);
  if (!dead && ageOf(lock) <= STALE_MS) return;
  const parked = `${lock}.stale-${randomUUID()}`;
  try {
    renameSync(lock, parked);
  } catch {
    return;
  }
  if (readText(parked) !== seen) {
    try {
      linkSync(parked, lock);
    } catch {
      // المكان اتاخد تاني: الـ lock الجديد هو اللي يفضل.
    }
  }
  rmSync(parked, { force: true });
}

/**
 * بيشغّل fn وهو ماسك الـ lock. الـ lock فيه صاحبه (host, pid, token)، ومحدش بيفكه غير صاحب الـ token.
 *
 * @param lock مسار ملف الـ lock (في الـ git common dir، فهو واحد لكل الـ worktrees)
 * @param fn   الشغل اللي لازم يحصل تحت الـ lock
 * @returns نتيجة fn
 */
export async function withStartLock(lock, fn) {
  const token = randomUUID();
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      const descriptor = openSync(lock, 'wx');
      writeFileSync(descriptor, JSON.stringify({ host: hostname(), pid: process.pid, token }));
      closeSync(descriptor);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() > deadline) fail(`another lane start holds ${lock}; retry later`);
      takeOverIfStale(lock);
      await delay(200 + Math.random() * 300);
    }
  }
  try {
    return await fn();
  } finally {
    if (parseOwner(readText(lock) ?? '')?.token === token) rmSync(lock, { force: true });
  }
}
