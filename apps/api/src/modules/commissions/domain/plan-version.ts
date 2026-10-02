import type { CommissionPlanVersion } from './plan-types.ts';

/**
 * يختار إصدار الموظفة بتاريخ النشاط؛ wholePeriod يرجع لبداية شهر تاريخ سريانه فقط.
 * الأحدث إنشاءً ثم رقم الإصدار يفوز حتى لو كان تاريخ سريانه أقدم.
 *
 * @param employeeId الموظفة صاحبة الخطة
 * @param businessDate تاريخ البند أو البيع المحلي المحسوم مسبقاً
 * @param versions الإصدارات المرشحة دون الحاجة لترتيبها
 * @returns الإصدار الفائز أو null لخطأ NO_PLAN عند الحاجة للخطة
 */
export function selectCommissionPlanVersion(
  employeeId: string,
  businessDate: string,
  versions: readonly CommissionPlanVersion[],
): CommissionPlanVersion | null {
  let selected: CommissionPlanVersion | null = null;
  for (const candidate of versions) {
    if (candidate.employeeId !== employeeId) continue;
    const applies =
      candidate.effectiveFrom <= businessDate ||
      (candidate.wholePeriod && candidate.effectiveFrom.slice(0, 7) === businessDate.slice(0, 7));
    if (!applies) continue;
    if (
      selected === null ||
      candidate.createdAt > selected.createdAt ||
      (candidate.createdAt === selected.createdAt && candidate.version > selected.version)
    ) {
      selected = candidate;
    }
  }
  return selected;
}
