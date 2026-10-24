import type { ReportBranchInputs } from './attendance-report-types.js';
import { attendanceMonthPeriod } from './attendance-period-dates.js';
import { computeAttendancePeriodReport } from './attendance-period-report.js';

/**
 * يجمع تقرير الموظفة في فرع أو كل فروع النشاط؛ الشهر فترة من أول يوم لآخر يوم بنفس أعمدة مواصفة 049 §5.
 * الفرق عمل ناقص التعاقد بعد الإجازة؛ كل الحسابات هنا لتظل القراءة إسقاطاً بلا قواعد مكررة.
 * الإجازة تخص الموظفة وفق AB-Q11، فتُحسب مرة لكل معرّف طلب مهما تكررت في مدخلات الفروع.
 * التقرير الشهري مفيش فيه حد لطلب، فكل الدوام والورديات بتتحسب زي ما هي.
 *
 * @param branches مدخلات الموظفة لكل فرع مصرح به
 * @param month الشهر الميلادي المطلوب
 * @returns أعمدة التقرير الصحيحة بالدقائق دون بيانات شخصية حساسة
 */
export function computeAttendanceMonthlyReport(branches: readonly ReportBranchInputs[], month: string) {
  return computeAttendancePeriodReport(branches, attendanceMonthPeriod(month), null);
}
