// الـ start lock المشترك بين كل الـ worktrees: اختيار البورت و docker run بيحصلوا تحته بس،
// عشان اتنين `up` في نفس اللحظة ميختاروش نفس البورت.
// الـ lock فولدر بيتعمل بـ mkdir (عملية ذرية)، وجواه owner.json فيه صاحبه (host, pid, startedAt, token).
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

/**
 * جيل الـ lock أو الـ guard: الـ inode بتاع الفولدر (بيفضل هو هو بعد الـ rename) والـ token لو اتكتب.
 *
 * @param dir مسار الفولدر
 * @returns { ino, age, owner }، أو undefined لو الفولدر مش موجود
 */
export function inspect(dir) {
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

/**
 * هوية الفولدر: الـ inode + وقت ميلاده. الـ inode لوحده مش كفاية، لأن النظام بيعيد استخدام رقم الـ inode
 * فور ما يتشال فولدر، فالفولدر اللي اتعمل مكانه ممكن يبقى بنفس الرقم.
 *
 * @param dir مسار الفولدر
 * @returns هوية الفولدر، أو undefined لو الفولدر مش موجود
 */
function identity(dir) {
  try {
    const stat = statSync(dir, { bigint: true });
    return `${stat.ino}:${stat.birthtimeNs}`;
  } catch {
    return undefined;
  }
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
  if (startedAt !== undefined && Math.abs(startedAt - owner.startedAt) > START_TOLERANCE_MS) {
    return false;
  }
  // اتأكدنا إنه هو، أو النظام مقالش (ومنسرقش lock على "مش عارف"): في الحالتين منسألش تاني قبل الـ TTL.
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

// على ويندوز الـ rename بيفشل لحظياً لو عملية تانية بتقرا owner.json أو الـ antivirus فاتح الفولدر.
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_ATTEMPTS = 5;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      if (!BUSY.has(error.code) || attempt === RENAME_ATTEMPTS) throw error;
      sleepSync(50 * attempt);
    }
  }
}

/**
 * ينسخ owner.json من الفولدر اليتيم جوه الـ lock الجديد. النسخ (مش النقل) هو الصح هنا: صاحب الـ lock ممكن
 * يكون لسه عايش، فبنحطه مكانه من غير ما نحرمه من الـ lock بتاعه. flag 'wx' يعني لو فيه owner.json
 * جاهز مش هنكتب فوقه.
 *
 * @param parked الفولدر اللي الـ lock اتنقل له
 * @param lock   مسار الـ lock
 * @returns true لو الـ owner اتنسخ، false لو النسخ فشل
 */
function copyOwner(parked, lock) {
  try {
    writeFileSync(join(lock, 'owner.json'), readFileSync(join(parked, 'owner.json')), {
      flag: 'wx',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * آخر حل: نشيل الفولدر الفاضي اللي عملناه، بس لو هو لسه نفس الفولدر (نفس الـ inode ووقت الميلاد).
 * rmdirSync مش rmSync: الفولدر اللي فيه owner ما بيتشالش، واللي حد تاني لمسه ما بيتشالش خالص.
 *
 * @param lock     مسار الـ lock
 * @param created هوية الفولدر اللي عملناه
 */
function removeEmptyLock(lock, created) {
  if (created === undefined || identity(lock) !== created) return;
  try {
    rmdirSync(lock);
  } catch (error) {
    // حد تاني لمس الفولدر أو ملّاه: نسيبه زي ما هو من غير ما نطبع.
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) {
      console.log(
        `could not remove empty ${lock} (${error.code}); delete it once no lane start is running`,
      );
    }
  }
}

/**
 * بيشيل الفولدر اليتيم بعد ما الـ lock رجع. المسح ممكن يفشل (الـ owner.json لسه متقفل عند اللي منع النقل)،
 * فالفشل ما بيرميش: الـ lock رجع فعلاً، وسطر واحد بيقول مين يمسح البواقي بإيده.
 *
 * @param parked الفولدر اللي الـ lock اتنقل له
 */
function removeParked(parked) {
  try {
    rmSync(parked, { recursive: true, force: true, maxRetries: RENAME_ATTEMPTS, retryDelay: 50 });
  } catch (error) {
    console.log(
      `left ${parked}: restored the lock but could not delete it (${error.code}); delete it once no lane start is running`,
    );
  }
}

/**
 * بيرجّع lock اتشال بالغلط لمكانه، من غير ما يستبدل lock تاني اتعمل في المكان ده.
 * rename على POSIX بيستبدل فولدر فاضي لسه متعمل بـ mkdir (#451)؛ mkdir بيفشل بدل ما يستبدل،
 * وبعده owner.json بيتنقل جوه. الـ inode بيتغير، لكن الفك بيبص على الـ token بس.
 * لو النقل فشل بننسخ الـ owner جوه (النسخة مش النقل: صاحب الـ lock ممكن يكون لسه عايش)، ولو النسخ كمان
 * فشل بنشيل الفولدر الفاضي اللي عملناه (بس لو هو لسه نفس الفولدر) والـ lock يفضل يتيم في parked.
 * مسح الفولدر الفاضي ده آمن: مفيش حاجة في الموديل ده بتمسح lock من غير صاحب قبل STALE_MS (takeOverIfStale
 * بيشيله بعد الـ 15 دقيقة بس، وreleaseStartLock/releaseGuard بيشتغلوا على الـ token بس، وwithStartLock بيمسح
 * فولدر mkdir هو عملها)؛ والفترة بين الـ mkdir والفحص والمسح جزء من الثانية، فـ identity طبقة تانية مش الدليل.
 *
 * @param lock         مسار الـ lock
 * @param parked       الفولدر اللي الـ lock اتنقل له
 * @param options.move دالة نقل owner.json (renameWithRetry افتراضياً)
 * @returns true لما صاحب الـ lock يرجع جوه lock، false لما الـ lock يفضل يتيم في parked
 */
export function restoreParked(lock, parked, { move = renameWithRetry } = {}) {
  try {
    mkdirSync(lock);
  } catch {
    console.log(
      `left ${parked}: it was not the stale lock; delete it once no lane start is running`,
    );
    return false;
  }
  const created = identity(lock);
  try {
    move(join(parked, 'owner.json'), join(lock, 'owner.json'));
  } catch (error) {
    // الـ lock اللي رجع لسه صاحبه مكتبش owner.json: هيكتبه في مكانه الأصلي.
    if (error.code !== 'ENOENT') {
      // النقل فشل بس صاحب الـ lock ممكن يكون لسه عايش، فالنسخة بترجّعه مكانه من غير ما نحرمه من الـ lock.
      if (!copyOwner(parked, lock)) {
        // آخر حل: نشيل الفولدر الفاضي اللي عملناه، والـ lock يفضل يتيم في parked.
        removeEmptyLock(lock, created);
        console.log(
          `left ${parked}: could not move its owner back (${error.code}); delete it once no lane start is running`,
        );
        return false;
      }
    }
  }
  removeParked(parked);
  return true;
}

// المسح بالاسم مش مشروط: ممكن يمسح جيل اتعمل بعد ما بصينا. فبنعمل rename ذري لاسم فريد، وبنمسح اللي اتنقل
// بس لو هو الجيل المتوقع، وإلا بنرجّعه. الفحص بيتعمل مرتين: على المكان نفسه قبل الـ rename، وعلى اللي اتنقل
// بعده. القراءة من جديد بتضيّق النافذة بس ما بتقفلهاش: من غير قفل ذري حد يقدر يبدّل المكان في نص النافذة.
// ولو الـ rename فشل بعد المحاولات بنقوله سطر واحد، والفشل نفسه مش بنرميه: الرمي وقت فك الـ start lock
// كان هيضيع نتيجة الشغل اللي اشتغل تحته.
function removeGeneration(dir, isExpected) {
  const parked = `${dir}.stale-${randomUUID()}`;
  if (!isExpected(inspect(dir))) return;
  try {
    renameWithRetry(dir, parked);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    console.log(`could not remove ${dir} (${error.code}); delete it once no lane start is running`);
    return;
  }
  if (isExpected(inspect(parked)))
    rmSync(parked, { recursive: true, force: true, maxRetries: RENAME_ATTEMPTS, retryDelay: 50 });
  else restoreParked(dir, parked);
}

/**
 * بيشيل guard فضل من reaper مات، بس لو لسه هو بالظبط الجيل اللي اتشاف قديم: اتنين ممكن يحكموا على نفس
 * الـ guard إنه قديم، والأول يشيله ويعمل guard جديد قبل ما التاني يوصل.
 *
 * @param guard مسار الـ guard
 * @param seen  الجيل اللي اتشاف (افتراضياً اللي موجود دلوقتي)
 */
export function clearStaleGuard(guard, seen = inspect(guard)) {
  if (seen === undefined || seen.age <= GUARD_STALE_MS) return;
  removeGeneration(guard, (parked) => sameGeneration(seen, parked));
}

/**
 * بيفك الـ guard بس لو الـ token بتاعه لسه بتاعنا: لو اتشال واتعمل guard جديد مكانه، ده مش بتاعنا نمسحه.
 *
 * @param guard مسار الـ guard
 * @param token الـ token اللي كتبناه وإحنا بنمسكه
 */
export function releaseGuard(guard, token) {
  if (inspect(guard)?.owner?.token !== token) return;
  removeGeneration(guard, (parked) => parked?.owner?.token === token);
}

// اللي بيشيلوا lock ميت بيشتغلوا واحد واحد: من غيره اتنين يحكموا على نفس الـ lock إنه ميت، الأول يشيله
// وحد جديد يمسك مكانه، والتاني يشيل الجديد ده وهو فاكره القديم (#449).
function withTakeoverGuard(lock, fn) {
  const guard = `${lock}.takeover`;
  const token = randomUUID();
  try {
    mkdirSync(guard);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    clearStaleGuard(guard);
    return;
  }
  const created = inspect(guard)?.ino;
  try {
    writeFileSync(join(guard, 'owner.json'), JSON.stringify({ token }));
  } catch (error) {
    // الـ token متكتبش، فـ releaseGuard مش هيعرفه: نشيله بالـ inode، بس لو لسه هو الجيل اللي عملناه.
    if (created !== undefined && inspect(guard)?.ino === created) {
      removeGeneration(guard, (parked) => parked?.ino === created);
    }
    // الـ guard راح من تحتنا (cleaner قديم شاله بين الـ mkdir والكتابة ورجّعه مكانه): ده مش فشل، الـ lock
    // لسه متاح، وwithStartLock جوه حلقة الانتظار هيعيد المحاولة في دورته الجاية.
    if (error.code === 'ENOENT') return;
    throw error;
  }
  try {
    // لو الـ guard بتاعنا اتشال كقديم واتعمل غيره قبل ما نكتب، نرجع ونحاول تاني.
    if (inspect(guard)?.owner?.token === token) fn();
  } finally {
    // فك الـ guard ما لازمش يرمي: فشله بينطبع سطر وخلاص، عشان حلقة الانتظار في withStartLock ما توقفش.
    try {
      releaseGuard(guard, token);
    } catch (error) {
      console.log(
        `could not release ${guard} (${error.code}); delete it once no lane start is running`,
      );
    }
  }
}

// جوه الـ guard بنعيد الفحص: اللي شفناه بره ممكن reaper تاني يكون شاله، وواحد جديد مسك مكانه.
function reap(lock) {
  const seen = inspect(lock);
  if (seen === undefined || !isStale(seen)) return;
  removeGeneration(lock, (parked) => sameGeneration(seen, parked));
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

// فك الـ start lock ما لازمش يرمي: فشله بينطبع سطر وخلاص، عشان ما يبقاش بيلغي نتيجة الشغل اللي جوه.
// removeGeneration أصلاً بيقول سطره لما الـ rename يفشل، فالـ catch هنا بيغطي غير المتوقع بس.
function releaseStartLock(lock, token) {
  if (inspect(lock)?.owner?.token !== token) return;
  try {
    removeGeneration(lock, (parked) => parked?.owner?.token === token);
  } catch (error) {
    console.log(
      `could not release ${lock} (${error.code}); delete it once no lane start is running`,
    );
  }
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
  let result;
  try {
    result = await fn();
  } catch (error) {
    // فك الـ lock ما بيغيّرش نتيجة الشغل: الخطأ اللي رميه fn هو اللي بيطلع، وخطأ فك الـ lock سطر تحذير بس.
    releaseStartLock(lock, token);
    throw error;
  }
  releaseStartLock(lock, token);
  return result;
}
