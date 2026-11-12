import { PackageRuleError } from './errors.js';

/**
 * بيحسب الرصيد المتاح لسطر الخدمة بعد خصم اختيارات مسودات الزيارة الأخرى.
 * الجلسات المحجوزة في سطور أخرى غير محفوظة من نفس الزيارة ليست متاحة لهذا السطر، والخادم يبقى المرجع النهائي للرصيد.
 *
 * @param componentRemaining رصيد مكوّن الباقة قبل خصم اختيارات المسودة
 * @param otherDraftPicks عدد الجلسات المختارة في السطور الأخرى
 * @returns الرصيد غير السالب المتبقي لهذا السطر
 */
export function remainingAfterDraftPicks(componentRemaining: number, otherDraftPicks: number): number {
  if (!Number.isSafeInteger(componentRemaining) || componentRemaining < 0
    || !Number.isSafeInteger(otherDraftPicks) || otherDraftPicks < 0) {
    throw new PackageRuleError('INVALID_REMAINING_SESSIONS');
  }
  return Math.max(0, componentRemaining - otherDraftPicks);
}
