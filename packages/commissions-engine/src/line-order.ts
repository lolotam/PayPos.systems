import type { CommissionLineOrder } from './commission-types.ts';

/**
 * يرتب البنود بوقت الخدمة ثم التسجيل ثم الهوية، لأن البند المتأخر يغيّر موضعه لا تاريخ تسجيله.
 *
 * @param lines بنود الفترة بأوقات UTC موحدة بوحدات microseconds
 * @returns نسخة مرتبة دون تعديل قائمة المدخلات
 */
export function orderCommissionLines<T extends CommissionLineOrder>(lines: readonly T[]): T[] {
  return [...lines].sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
    if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
    return a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0;
  });
}
