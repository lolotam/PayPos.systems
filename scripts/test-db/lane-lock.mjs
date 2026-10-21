// الـ start lock المشترك بين كل الـ worktrees: اختيار البورت و docker run بيحصلوا تحته بس،
// عشان اتنين `up` في نفس اللحظة ميختاروش نفس البورت.
// الـ lock فولدر بيتعمل بـ mkdir (عملية ذرية)، وجواه owner.json فيه صاحبه (host, pid, token).
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { fail } from './lane-error.mjs';

const WAIT_MS = 120_000;
// العمر بيحكم بس لما مقدرش أتأكد من صاحب الـ lock (جهاز تاني أو owner.json لسه متكتبش):
// docker run ممكن ياخد دقايق في pull الـ image، فالمدة لازم تبقى طويلة.
const STALE_MS = 15 * 60_000;

// جيل الـ lock: الـ inode بتاع الفولدر (بيفضل هو هو بعد الـ rename) والـ token لو اتكتب.
function inspect(dir) {
  let stat;
  try {
    stat = statSync(dir, { bigint: true });
  } catch {
    return undefined;
  }
  let owner;
  try {
    owner = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'));
  } catch {
    owner = undefined;
  }
  return { ino: stat.ino, age: Date.now() - Number(stat.mtimeMs), owner };
}

function isStale(seen) {
  const { owner } = seen;
  // صاحب على نفس الجهاز: الـ pid بس اللي يحكم، عمر الـ lock مالوش دعوة طول ما العملية عايشة.
  if (owner?.host === hostname() && Number.isInteger(owner.pid)) {
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (error) {
      return error.code !== 'EPERM';
    }
  }
  return seen.age > STALE_MS;
}

const sameGeneration = (a, b) =>
  b !== undefined && a.ino === b.ino && a.owner?.token === b.owner?.token;

// الـ rename ذري: اللي يكسبه بس هو اللي يمسك الجيل اللي اتنقل. بنمسحه بس لو هو بالظبط الجيل اللي حكمنا عليه.
// لو طلع جيل تاني (lock جديد اتعمل في النص) بنرجّعه لو المكان فاضي، وإلا بنسيبه: فولدر يتيم أمان،
// لكن صاحبين لنفس الـ lock لأ.
function takeOverIfStale(lock) {
  const seen = inspect(lock);
  if (seen === undefined || !isStale(seen)) return;
  const parked = `${lock}.stale-${randomUUID()}`;
  try {
    renameSync(lock, parked);
  } catch {
    return;
  }
  if (sameGeneration(seen, inspect(parked))) {
    rmSync(parked, { recursive: true, force: true });
    return;
  }
  if (!existsSync(lock)) {
    try {
      renameSync(parked, lock);
      return;
    } catch {
      // المكان اتاخد تاني: نسيبه يتيم.
    }
  }
  console.log(`left ${parked}: it was not the stale lock; delete it once no lane start is running`);
}

/**
 * بيشغّل fn وهو ماسك الـ lock، ومحدش بيفكه غير صاحب الـ token.
 *
 * @param lock مسار فولدر الـ lock (في الـ git common dir، فهو واحد لكل الـ worktrees)
 * @param fn   الشغل اللي لازم يحصل تحت الـ lock
 * @returns نتيجة fn
 */
export async function withStartLock(lock, fn) {
  const token = randomUUID();
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() > deadline) fail(`another lane start holds ${lock}; retry later`);
      takeOverIfStale(lock);
      await delay(200 + Math.random() * 300);
      continue;
    }
    try {
      writeFileSync(
        join(lock, 'owner.json'),
        JSON.stringify({ host: hostname(), pid: process.pid, token }),
      );
      break;
    } catch (error) {
      // الفولدر اتعمل بس صاحبه متكتبش: نشيله عشان ميفضلش lock من غير صاحب.
      rmSync(lock, { recursive: true, force: true });
      throw error;
    }
  }
  try {
    return await fn();
  } finally {
    if (inspect(lock)?.owner?.token === token) rmSync(lock, { recursive: true, force: true });
  }
}
