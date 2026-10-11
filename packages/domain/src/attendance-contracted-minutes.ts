import { contractedMinutes, defaultShiftMinutes } from './default-shifts.js';
import type { ReportContract, ReportLeave } from './attendance-report-types.js';

/**
 * ينشئ أيام الشهر الميلادي بترتيب ثابت؛ يوم الأسبوع يبدأ بالسبت مثل دوام الموظفة.
 *
 * @param month الشهر الصحيح YYYY-MM
 * @returns الأيام المدنية ويوم الأسبوع لكل منها، دون الاعتماد على ساعة النظام
 */
export function attendanceMonthDates(month: string) {
  const start = Date.parse(`${month}-01T00:00:00Z`);
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return Array.from({ length: (next.getTime() - start) / 86_400_000 }, (_, index) => {
    const instant = new Date(start + index * 86_400_000);
    return { date: instant.toISOString().slice(0, 10), weekday: (instant.getUTCDay() + 1) % 7 };
  });
}

/**
 * يحدد أيام الشهر المؤهلة للتعاقد والإجازة بنفس حدود التعيين وارتباط الفرع حتى لا تختلف أعمدة التقرير.
 * نهاية العقد مشمولة ونهاية ارتباط الفرع مستبعدة؛ غياب التعاقد لا يثبت أي يوم ارتباط.
 *
 * @param contract حدود التعيين والعقد وارتباط الفرع أو غيابها
 * @param month الشهر الميلادي المطلوب
 * @returns أيام الشهر الواقعة داخل التعيين وأي فترة ارتباط بالفرع
 */
export function attendanceContractDates(contract: ReportContract | null, month: string) {
  return contract === null ? [] : attendanceMonthDates(month).filter(({ date }) => date >= contract.hire_date &&
    (contract.contract_end === null || date <= contract.contract_end) &&
    contract.links.some((link) => link.from <= date && (link.to === null || date < link.to)));
}

function localMinute(instant: string, formatter: Intl.DateTimeFormat): number {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return Date.parse(`${parts['year']}-${parts['month']}-${parts['day']}T00:00:00Z`) / 60_000 +
    Number(parts['hour']) * 60 + Number(parts['minute']);
}
function mergedOverlap(intervals: readonly { start: number; end: number }[], start: number, end: number): number {
  let removed = 0, last = start;
  for (const interval of intervals.toSorted((a, b) => a.start - b.start)) {
    const from = Math.max(start, last, interval.start), to = Math.min(end, interval.end);
    if (from < to) { removed += to - from; last = to; }
  }
  return removed;
}

/**
 * يطرح كل إجازة مقبولة من الدوام الحالي وفق AB-Q4؛ الكامل يزيل اليوم والجزئي تقاطعه مع نافذة الدوام فقط.
 * وفق AB-Q11 تُطبق إجازات الموظفة من أي فرع على أيام ارتباط هذا الفرع؛ البريك مشمول ونهاية الارتباط مستبعدة.
 *
 * @param contract الدوام الحالي وحدود التعيين والارتباط أو غيابه
 * @param month الشهر الميلادي
 * @param leave إجازات الموظفة المقبولة من كل الفروع
 * @param timezone منطقة الفرع لتفسير تقاطع الإجازة الجزئية مع الدوام الحالي
 * @returns الدقائق المتفق عليها بعد طرح الإجازات دون نزولها تحت الصفر
 */
export function attendanceContractedMinutes(contract: ReportContract | null, month: string,
  leave: readonly ReportLeave[], timezone: string): number {
  if (!contract) return 0;
  const dates = attendanceContractDates(contract, month);
  const baseline = contractedMinutes(contract.entries, dates);
  if (leave.length === 0) return baseline;
  const full = leave.filter((entry) => entry.kind === 'FULL_DAY');
  const partial = leave.filter((entry) => entry.kind === 'PARTIAL');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const intervals = partial.map((entry) => ({ start: localMinute(entry.starts_at, formatter), end: localMinute(entry.ends_at, formatter) }));
  const defaults = new Map(contract.entries.map((entry) => [entry.day, entry]));
  const removed = dates.reduce((total, { date, weekday }) => {
    const entry = defaults.get(weekday);
    if (!entry) return total;
    const length = defaultShiftMinutes(entry);
    if (full.some((item) => item.from <= date && date <= item.to)) return total + length;
    const start = Date.parse(`${date}T00:00:00Z`) / 60_000 + Number(entry.start.slice(0, 2)) * 60 + Number(entry.start.slice(3, 5));
    return total + mergedOverlap(intervals, start, start + length);
  }, 0);
  return Math.max(0, baseline - removed);
}

/**
 * يعرض الإجازات المقبولة حسب النوع داخل الأيام المؤهلة فقط؛ الجزئي بدقائقه الفعلية لا كسور أيام.
 * اتحاد أيام الفروع يمنع احتساب إجازة خارج كل الارتباطات أو تكرار اليوم بين فرعين.
 *
 * @param leaves إجازات الموظفة المقبولة دون تكرار الطلب بين الفروع
 * @param dates أيام الشهر المؤهلة للتعيين وارتباط الفرع أو اتحادها لكل الفروع
 * @returns أربعة أنواع ثابتة مع الأيام والدقائق الجزئية وفق AB-Q4
 */
export function attendanceLeaveSummary(leaves: readonly ReportLeave[], dates: readonly { date: string }[]) {
  const eligibleDates = new Set(dates.map(({ date }) => date));
  return (['ANNUAL', 'SICK', 'UNPAID', 'OTHER'] as const).map((type) => {
    const entries = leaves.filter((entry) => entry.type === type);
    return { type, days: [...eligibleDates].filter((date) => entries.some((entry) => entry.kind === 'FULL_DAY' &&
      entry.from <= date && date <= entry.to)).length,
    partial_minutes: entries.filter((entry) => entry.kind === 'PARTIAL' && eligibleDates.has(entry.from))
      .reduce((total, entry) => total + Math.floor((Date.parse(entry.ends_at) - Date.parse(entry.starts_at)) / 60_000), 0) };
  });
}
