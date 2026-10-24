import type { AttendancePeriod, ReportContract, ReportLeave } from './attendance-report-types.js';

/**
 * يبني أيام الفترة من يوم العمل الأول لحد الأخير بترتيب ثابت؛ يوم الأسبوع يبدأ بالسبت مثل دوام الموظفة.
 *
 * @param period الفترة المطلوبة، الطرفين مشمولين
 * @returns الأيام المدنية ويوم الأسبوع لكل منها، دون الاعتماد على ساعة النظام
 */
export function attendancePeriodDates(period: AttendancePeriod) {
  const start = Date.parse(`${period.from}T00:00:00Z`);
  const end = Date.parse(`${period.to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
  return Array.from({ length: (end - start) / 86_400_000 + 1 }, (_, index) => {
    const instant = new Date(start + index * 86_400_000);
    return { date: instant.toISOString().slice(0, 10), weekday: (instant.getUTCDay() + 1) % 7 };
  });
}

/**
 * يحدد أيام الفترة المؤهلة للتعاقد والإجازة بنفس حدود التعيين وارتباط الفرع حتى لا تختلف أعمدة التقرير.
 * نهاية العقد مشمولة ونهاية ارتباط الفرع مستبعدة؛ غياب التعاقد لا يثبت أي يوم ارتباط.
 *
 * @param contract حدود التعيين والعقد وارتباط الفرع أو غيابها
 * @param period الفترة المطلوبة
 * @returns أيام الفترة الواقعة داخل التعيين وأي فترة ارتباط بالفرع
 */
export function attendanceContractPeriodDates(contract: ReportContract | null, period: AttendancePeriod) {
  return contract === null ? [] : attendancePeriodDates(period).filter(({ date }) => date >= contract.hire_date &&
    (contract.contract_end === null || date <= contract.contract_end) &&
    contract.links.some((link) => link.from <= date && (link.to === null || date < link.to)));
}

/**
 * يقول إن الإجازة المقبولة تغطي اليوم ده؛ الكامل يغطي كل يوم بين بدايتها ونهايتها، والجزئي يوم بدايته بس.
 * نفس القاعدة بتحسب في عمود الإجازة وفي التغطية عشان ما يختلفوش (ST-Q7).
 *
 * @param leave الإجازة المقبولة
 * @param date يوم العمل المحلي
 * @returns هل الإجازة تغطي اليوم ده
 */
export function attendanceLeaveCoversDate(leave: ReportLeave, date: string): boolean {
  return leave.kind === 'FULL_DAY' ? leave.from <= date && date <= leave.to : leave.from === date;
}

/**
 * يحوّل الشهر الميلادي لفترة من أول يوم لآخر يوم؛ التقرير الشهري مجرد فترة زي أي فترة.
 *
 * @param month الشهر الصحيح YYYY-MM
 * @returns الفترة المقابلة للشهر، أو فترة يوم واحد لو الشهر مش صحيح
 */
export function attendanceMonthPeriod(month: string): AttendancePeriod {
  const start = Date.parse(`${month}-01T00:00:00Z`);
  if (Number.isNaN(start)) return { from: `${month}-01`, to: `${month}-01` };
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from: `${month}-01`, to: new Date(next.getTime() - 86_400_000).toISOString().slice(0, 10) };
}
