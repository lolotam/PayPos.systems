// أدوات الاختبار المشتركة بين ملفي اختبار الـ lock: الحاوية المؤقتة، ومسار قفل جديد، وبذور owner.json.
// الأدوات دي مشتركة عشان منطق البذور يبقى في مكان واحد، فمفيش نسختين من نفس البذور فيملا يتوازنوا.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * بيعمل حاوية مؤقتة لاختبارات الـ lock، وكل قفل جديد بياخد مسار فريد جواها.
 *
 * @returns { freshLock, cleanup } دالة مسار قفل جديد، ودالة تنظيف الحاوية
 */
export function createLockRoot() {
  const root = mkdtempSync(join(tmpdir(), 'pospay-lane-lock-'));
  let count = 0;
  return {
    freshLock: () => join(mkdtempSync(join(root, `case-${++count}-`)), 'lock.d'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * يبذر قفل بصاحب، بالشكل نفسه اللي withStartLock بيكتبه.
 *
 * @param lock  مسار فولدر الـ lock
 * @param owner خانات صاحب الـ lock (token، pid، startedAt)
 */
export function seedLock(lock, owner) {
  mkdirSync(lock);
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ host: hostname(), ...owner }));
}

/**
 * بيقرا صاحب الـ lock من owner.json.
 *
 * @param dir مسار فولدر الـ lock
 * @returns صاحب الـ lock بعد ما اتقرا
 */
export const ownerOf = (dir) => JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'));
