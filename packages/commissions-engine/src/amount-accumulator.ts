import type { CommissionPricingLine } from './commission-types.ts';

/**
 * يضيف نصيب البند المشارك في الحد بعد تسعيره، بصرف النظر عن قاعدته أو تغيير الخطة.
 *
 * @param before مجمّع المبلغ السابق على مستوى الفترة للموظفة
 * @param line النصيب وعلامة المشاركة؛ البند المستبعد لا يغيّر المجمّع
 * @returns المجمّع الذي تستخدمه الموظفة للبند التالي
 */
export function advanceAmountAccumulator(before: bigint, line: CommissionPricingLine): bigint {
  return before + (line.counts ? line.netShare : 0n);
}
