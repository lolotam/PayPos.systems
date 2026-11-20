import type { CommissionPlanVersion } from './plan-types.ts';

/**
 * يختار إصدار الموظفة بتاريخ النشاط؛ wholePeriod يرجع لبداية شهر تاريخ سريانه فقط.
 * الأحدث إنشاءً ثم رقم الإصدار يفوز حتى لو كان تاريخ سريانه أقدم.
 * إصدار الإصلاح (repairPeriod) يُختار في شهره فقط دون اختبار تاريخ سريانه أو wholePeriod،
 * ولما مايكونش فيه إصدار عادي يغطي التاريخ بيغطي أي يوم خطته ناقصة في شهره،
 * فالسطور اللي ليها خطة عادية تفضل عليها ومايلمسهاش الإصلاح (D-12, CS-Q11).
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
  const ordinary = bestVersion(employeeId, versions, (candidate) => {
    if (candidate.repairPeriod !== null) return false;
    return (
      candidate.effectiveFrom <= businessDate ||
      (candidate.wholePeriod && candidate.effectiveFrom.slice(0, 7) === businessDate.slice(0, 7))
    );
  });
  if (ordinary !== null) return ordinary;
  return bestVersion(
    employeeId,
    versions,
    (candidate) => candidate.repairPeriod === businessDate.slice(0, 7),
  );
}

function bestVersion(
  employeeId: string,
  versions: readonly CommissionPlanVersion[],
  applies: (candidate: CommissionPlanVersion) => boolean,
): CommissionPlanVersion | null {
  let selected: CommissionPlanVersion | null = null;
  for (const candidate of versions) {
    if (candidate.employeeId !== employeeId) continue;
    if (!applies(candidate)) continue;
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
