import type { CommissionPlanVersion } from './plan-types.ts';

/**
 * يختار إصدار الموظفة بتاريخ النشاط؛ wholePeriod يرجع لبداية شهر تاريخ سريانه فقط.
 * الأحدث إنشاءً ثم رقم الإصدار يفوز حتى لو كان تاريخ سريانه أقدم.
 * إصدار الإصلاح (repairPeriod) يُختار في شهره فقط، ولما مايكونش فيه إصدار عادي يغطي التاريخ،
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
  const ordinary = bestVersion(
    employeeId,
    businessDate,
    versions,
    (candidate) => candidate.repairPeriod === null,
  );
  if (ordinary !== null) return ordinary;
  return bestVersion(
    employeeId,
    businessDate,
    versions,
    (candidate) => candidate.repairPeriod === businessDate.slice(0, 7),
  );
}

function bestVersion(
  employeeId: string,
  businessDate: string,
  versions: readonly CommissionPlanVersion[],
  eligible: (candidate: CommissionPlanVersion) => boolean,
): CommissionPlanVersion | null {
  let selected: CommissionPlanVersion | null = null;
  for (const candidate of versions) {
    if (candidate.employeeId !== employeeId) continue;
    if (!eligible(candidate)) continue;
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
