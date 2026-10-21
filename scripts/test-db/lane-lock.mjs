// الـ start lock المشترك بين كل الـ worktrees: اختيار البورت و docker run بيحصلوا تحته بس،
// عشان اتنين `up` في نفس اللحظة ميختاروش نفس البورت.
// الـ lock فولدر بيتعمل بـ mkdir (عملية ذرية)، وجواه owner.json فيه صاحبه (host, pid, startedAt, token).
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { fail } from './lane-error.mjs';
import { ownStartMs, processStartMs } from './lane-process.mjs';

const WAIT_MS = 120_000;
// العمر بيحكم بس لما مقدرش أتأكد من صاحب الـ lock (جهاز تاني أو owner.json لسه متكتبش):
// docker run ممكن ياخد دقايق في pull الـ image، فالمدة لازم تبقى طويلة.
const STALE_MS = 15 * 60_000;
// اللي بيشيل lock ميت بيمسك الـ guard ملي ثواني؛ guard أقدم من كده صاحبه مات في النص.
const GUARD_STALE_MS = 60_000;
// وقت البداية اللي العملية سجلته عن نفسها والوقت اللي النظام بيقوله بيختلفوا شوية (دقة الساعة وتعديلاتها)؛
// pid اتعاد استخدامه بيبقى بادئ بعد صاحبه الأصلي بكتير.
const START_TOLERANCE_MS = 5_000;
// سؤال النظام عن وقت البداية بياخد ثواني على ويندوز، فلما صاحب الـ lock يتأكد إنه هو، مبنسألش تاني قبل دقيقة.
const IDENTITY_TTL_MS = 60_000;
const confirmedOwners = new Map();

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

// الـ pid عايش مش كفاية: لازم كمان يكون هو نفس العملية اللي مسكت الـ lock (#450).
function ownerAlive(owner) {
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (error.code !== 'EPERM') return false;
  }
  // owner.json من نسخة أقدم من غير startedAt: الـ pid بس اللي يحكم زي الأول.
  if (!Number.isFinite(owner.startedAt)) return true;
  const key = `${owner.pid}:${owner.startedAt}`;
  if (Date.now() - (confirmedOwners.get(key) ?? -Infinity) < IDENTITY_TTL_MS) return true;
  const startedAt = processStartMs(owner.pid);
  // النظام مقالش: منسرقش lock على "مش عارف".
  if (startedAt === undefined) return true;
  if (Math.abs(startedAt - owner.startedAt) > START_TOLERANCE_MS) return false;
  confirmedOwners.set(key, Date.now());
  return true;
}

function isStale(seen) {
  const { owner } = seen;
  // صاحب على نفس الجهاز: هويته بس اللي تحكم، عمر الـ lock مالوش دعوة طول ما العملية عايشة.
  if (owner?.host === hostname() && Number.isInteger(owner.pid)) return !ownerAlive(owner);
  return seen.age > STALE_MS;
}

const sameGeneration = (a, b) =>
  b !== undefined && a.ino === b.ino && a.owner?.token === b.owner?.token;

// guard فضل من reaper مات: بنشيله بنفس حيلة الـ rename لاسم فريد، فاتنين ميشيلوش guard جديد مكانه.
function clearStaleGuard(guard) {
  const seen = inspect(guard);
  if (seen === undefined || seen.age <= GUARD_STALE_MS) return;
  const parked = `${guard}.stale-${randomUUID()}`;
  try {
    renameSync(guard, parked);
  } catch {
    return;
  }
  rmSync(parked, { recursive: true, force: true });
}

// اللي بيشيلوا lock ميت بيشتغلوا واحد واحد: من غيره اتنين يحكموا على نفس الـ lock إنه ميت، الأول يشيله
// وحد جديد يمسك مكانه، والتاني يشيل الجديد ده وهو فاكره القديم (#449).
function withTakeoverGuard(lock, fn) {
  const guard = `${lock}.takeover`;
  try {
    mkdirSync(guard);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    clearStaleGuard(guard);
    return;
  }
  try {
    fn();
  } finally {
    rmSync(guard, { recursive: true, force: true });
  }
}

/**
 * بيرجّع lock اتشال بالغلط لمكانه، من غير ما يستبدل lock تاني اتعمل في المكان ده.
 * rename على POSIX بيستبدل فولدر فاضي لسه متعمل بـ mkdir (#451)؛ mkdir بيفشل بدل ما يستبدل،
 * وبعده owner.json بيتنقل جوه. الـ inode بيتغير، لكن الفك بيبص على الـ token بس.
 *
 * @param lock   مسار الـ lock
 * @param parked الفولدر اللي الـ lock اتنقل له
 * @returns true لو رجع، false لو فضل يتيم في parked
 */
export function restoreParked(lock, parked) {
  try {
    mkdirSync(lock);
  } catch {
    console.log(
      `left ${parked}: it was not the stale lock; delete it once no lane start is running`,
    );
    return false;
  }
  try {
    renameSync(join(parked, 'owner.json'), join(lock, 'owner.json'));
  } catch (error) {
    // الـ lock اللي رجع لسه صاحبه مكتبش owner.json: هيكتبه في مكانه الأصلي.
    if (error.code !== 'ENOENT') throw error;
  }
  rmSync(parked, { recursive: true, force: true });
  return true;
}

// جوه الـ guard بنعيد الفحص: اللي شفناه بره ممكن reaper تاني يكون شاله، وواحد جديد مسك مكانه.
// الـ rename ذري: بنمسح اللي اتنقل بس لو هو بالظبط الجيل اللي حكمنا عليه، وإلا بنرجّعه.
function reap(lock) {
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
  restoreParked(lock, parked);
}

/**
 * بيشيل الـ lock لو صاحبه مات، تحت الـ takeover guard.
 *
 * @param lock مسار الـ lock
 */
export function takeOverIfStale(lock) {
  const seen = inspect(lock);
  if (seen === undefined || !isStale(seen)) return;
  withTakeoverGuard(lock, () => reap(lock));
}

/**
 * بيشغّل fn وهو ماسك الـ lock، ومحدش بيفكه غير صاحب الـ token.
 *
 * @param lock            مسار فولدر الـ lock (في الـ git common dir، فهو واحد لكل الـ worktrees)
 * @param fn              الشغل اللي لازم يحصل تحت الـ lock
 * @param options.waitMs  أقصى انتظار للـ lock قبل ما نفشل
 * @returns نتيجة fn
 */
export async function withStartLock(lock, fn, { waitMs = WAIT_MS } = {}) {
  const token = randomUUID();
  const deadline = Date.now() + waitMs;
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
        JSON.stringify({ host: hostname(), pid: process.pid, startedAt: ownStartMs(), token }),
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
