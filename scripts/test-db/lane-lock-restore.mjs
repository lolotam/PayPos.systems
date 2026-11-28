// النصف المسؤول عن استرجاع الـ lock: بيرجّع lock اتنقل (park) لمكانه من غير ما يسلبه من صاحب لسه عايش،
// ومعاه أدوات الـ rename/المسح اللي بتشاركها مع النصف التاني من الـ lock (renameWithRetry، RENAME_ATTEMPTS).
// الاعتماد بين النصفين واحد الاتجاه: lane-lock.mjs بيستورد من هنا، وهنا مش بيستورد منه، فمفيش استيراد دائري.
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// على ويندوز الـ rename بيفشل لحظياً لو عملية تانية بتقرا owner.json أو الـ antivirus فاتح الفولدر.
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
// عدد المحاولات: نفس الرقم بيتستخدم لمسح الملفات كمان، لأن قفل ويندوز بيلفّ الاتنين بنفس الطريقة.
export const RENAME_ATTEMPTS = 5;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * rename مع إعادة محاولة لأكواد ويندوز المزدحمة: الـ rename ذري، فإعادة المحاولة ما بتغيّرش النتيجة.
 *
 * @param from المسار المصدر
 * @param to   المسار الهدف
 */
export function renameWithRetry(from, to) {
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

/**
 * ينسخ owner.json من الفولدر اليتيم جوه الـ lock الجديد. النسخ (مش النقل) هو الصح هنا: صاحب الـ lock ممكن
 * يكون لسه عايش، فبنحطه مكانه من غير ما نحرمه من الـ lock بتاعه. الملف بيتعمل حصرياً ('wx')، فـ owner.json
 * بتاع حد تاني مش بنكتب فوقه ولا بنمسحه؛ واللي بنعمله إحنا بنقفله قبل المسح (ويندوز مش بيمسح ملف مفتوح)
 * وبنمسحه بس طول ما الفولدر لسه هو الفولدر اللي عملناه.
 *
 * @param parked  الفولدر اللي الـ lock اتنقل له
 * @param lock    مسار الـ lock
 * @param created هوية الفولدر اللي عملناه
 * @param write   دالة كتابة الـ owner: بتاخد الـ fd المفتوح ومحتوى الـ owner (writeFileSync افتراضياً)
 * @returns true لو الـ owner اتنسخ، false لو النسخ فشل
 */
function copyOwner(parked, lock, created, write = writeFileSync) {
  if (created === undefined || identity(lock) !== created) return false;
  let owner;
  try {
    owner = readFileSync(join(parked, 'owner.json'));
  } catch {
    return false;
  }
  const ownerFile = join(lock, 'owner.json');
  let fd;
  try {
    fd = openSync(ownerFile, 'wx');
  } catch {
    // الملف موجود من قبل (بتاع حد تاني) أو اتعملش: مش بنكتب فوقه ومش بنمسحه.
    return false;
  }
  let failed = false;
  try {
    write(fd, owner);
  } catch {
    failed = true;
  }
  try {
    closeSync(fd);
  } catch {
    failed = true;
  }
  if (!failed) return true;
  discardPartialOwner(lock, created);
  return false;
}

/**
 * بيشيل owner.json الجزئي اللي عملناه، بس لو الفولدر لسه بتاعنا؛ والمسح بيتكرر لأن ويندوز ممكن يقفل
 * الملف لحظة، والـ owner اللي مش بيتقرا هيسدّ الـ lock لحد ما يبقى قديم. والمسح بـ recursive مع إن الملف
 * file، لأن Node بيتجاهل maxRetries و retryDelay من غير recursive.
 *
 * @param lock     مسار الـ lock
 * @param created هوية الفولدر اللي عملناه
 */
function discardPartialOwner(lock, created) {
  if (identity(lock) !== created) return;
  const ownerFile = join(lock, 'owner.json');
  try {
    rmSync(ownerFile, {
      force: true,
      recursive: true,
      maxRetries: RENAME_ATTEMPTS,
      retryDelay: 50,
    });
  } catch (error) {
    console.log(
      `could not remove partial ${ownerFile} (${error.code}); delete it once no lane start is running`,
    );
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
 * @param options.write دالة كتابة owner.json (writeFileSync افتراضياً)
 * @returns true لما صاحب الـ lock يرجع جوه lock، false لما الـ lock يفضل يتيم في parked
 */
export function restoreParked(
  lock,
  parked,
  { move = renameWithRetry, write = writeFileSync } = {},
) {
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
      if (!copyOwner(parked, lock, created, write)) {
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
