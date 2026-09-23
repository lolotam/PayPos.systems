/**
 * الـ time zone الفعلي للفرع (PRD D-10، قرار Waleed 2026-09-23): بتاع الفرع لو اتحط، وإلا بتاع النشاط. ده اللي يوم
 * الحضور والتقارير والتواريخ المعروضة بتتحسب عليه.
 *
 * @param branchTimeZone   الـ time zone اللي اتحط للفرع، أو null
 * @param businessTimeZone الـ time zone بتاع النشاط اللي الفرع تبعه
 * @returns الـ time zone اللي بيتستخدم للفرع
 */
export function effectiveTimeZone(branchTimeZone: string | null, businessTimeZone: string): string {
  return branchTimeZone ?? businessTimeZone;
}
