import type { CommissionPeriodEmployee } from './commission-line-types.ts';
import type {
  CommissionSalaryInputEvent,
  CommissionSalaryProjectionRow,
  CommissionTipInputEvent,
  CommissionTipProjectionRow,
  CommissionTipProjectionSession,
} from './commission-tip-salary-inputs.ts';
import { CommissionTipSalaryInputInvalidError } from './errors.ts';

/**
 * يحسب كل شهر يكون الراتب فيه هو المختار في آخر يوم تقويمي، داخل فترة السريان
 * وحدود الشهر الحالي وشهر إنشاء النشاط؛ البداية من شهر السريان أو شهر الإنشاء
 * تمنع المرور على سنوات قديمة لا يمكن أن تتأثر.
 *
 * @param effectiveFrom تاريخ بدء سريان الراتب بصيغة YYYY-MM-DD
 * @param nextFrom تاريخ السريان التالي، أو null عندما لا يوجد
 * @param currentPeriod الشهر الحالي للنشاط بصيغة YYYY-MM
 * @param startPeriod شهر إنشاء النشاط بصيغة YYYY-MM
 * @returns الشهور المتأثرة فريدة ومرتبة تصاعدياً، وقد تكون فارغة
 */
export function salaryAffectedPeriods(
  effectiveFrom: string,
  nextFrom: string | null,
  currentPeriod: string,
  startPeriod: string,
): string[] {
  const effectivePeriod = effectiveFrom.slice(0, 7);
  const firstPeriod = effectivePeriod > startPeriod ? effectivePeriod : startPeriod;
  const affected: string[] = [];
  for (let period = firstPeriod; period <= currentPeriod; period = nextPeriod(period)) {
    const lastDay = lastCalendarDay(period);
    if (lastDay < effectiveFrom) continue;
    if (nextFrom !== null && lastDay >= nextFrom) break;
    affected.push(period);
  }
  return affected;
}

/**
 * يجمع شهر البقشيش المحفوظ مع شهر تاريخ الحدث الجديد حتى يُفتح كل شهر تغيّرت مدخلاته.
 *
 * @param heldPeriod شهر النسخة المحفوظة، أو null عندما لا توجد نسخة سابقة
 * @param newBusinessDate تاريخ العمل الجديد بصيغة YYYY-MM-DD
 * @returns الشهور المتأثرة فريدة ومرتبة تصاعدياً
 */
export function tipAffectedPeriods(heldPeriod: string | null, newBusinessDate: string): string[] {
  const periods = new Set<string>([newBusinessDate.slice(0, 7)]);
  if (heldPeriod !== null) periods.add(heldPeriod);
  return [...periods].sort();
}

/**
 * يشتق الموظفات اللاتي يحتجن تصحيحاً في كل شهر مغلق من اتحاد صفوف البقشيش المحفوظة
 * قبل الاستبدال وصفوف الحدث الجديد؛ الموظفة التي فقدت بقشيشها تدخل النتيجة لأن صفها
 * المجمّد سيعيد حسابه صفراً، وأزواج الشهر المفتوح تُهمل لأنه لا يحتاج تصحيحاً.
 *
 * @param held النسخة المحفوظة للجلسة بصفوفها وشهرها، أو null عند غيابها
 * @param next النسخة الجديدة للجلسة بصفوفها وتاريخ عملها
 * @param closedPeriods الشهور المتأثرة المغلقة وحدها
 * @returns أزواج الشهر والموظفة، فريدة ومرتبة بالشهر ثم بهوية الموظفة
 */
export function affectedCommissionTipEmployees(
  held: (Pick<CommissionTipProjectionSession, 'rows'> & { readonly period: string }) | null,
  next: Pick<CommissionTipProjectionSession, 'businessDate' | 'rows'>,
  closedPeriods: readonly string[],
): CommissionPeriodEmployee[] {
  const closed = new Set(closedPeriods);
  const pairs = new Map<string, CommissionPeriodEmployee>();
  const add = (rows: readonly CommissionTipProjectionRow[], period: string): void => {
    if (!closed.has(period)) return;
    for (const row of rows) {
      pairs.set(`${period}:${row.employeeId}`, { period, employeeId: row.employeeId });
    }
  };
  if (held !== null) add(held.rows, held.period);
  add(next.rows, next.businessDate.slice(0, 7));
  return [...pairs.values()].sort((left, right) => {
    if (left.period !== right.period) return left.period < right.period ? -1 : 1;
    if (left.employeeId === right.employeeId) return 0;
    return left.employeeId < right.employeeId ? -1 : 1;
  });
}

/**
 * يرفض نقل جلسة بقشيش موجودة إلى نشاط آخر؛ النشاط جزء ثابت من هوية الإسقاط.
 *
 * @param held الإسقاط المحفوظ بعد قفل الجلسة، أو null عند غيابه
 * @param event حدث البقشيش الوارد بهوية النشاط المطلوبة
 * @returns لا شيء عند ثبات هوية النشاط
 */
export function assertTipIdentityUnchanged(
  held: CommissionTipProjectionSession | null,
  event: CommissionTipInputEvent,
): void {
  if (held !== null && held.businessId.toLowerCase() !== event.businessId.toLowerCase()) {
    throw new CommissionTipSalaryInputInvalidError('TIP_IDENTITY_CHANGED');
  }
}

/**
 * يرفض نقل راتب موجود إلى نشاط آخر؛ المقارنة بلا حساسية لحالة أحرف UUID.
 *
 * @param held صف الراتب المحفوظ بعد القفل، أو null عند غيابه
 * @param event حدث الراتب بعد حسم نشاطه من الحدث أو من الموظفة
 * @returns لا شيء عند ثبات هوية النشاط
 */
export function assertSalaryIdentityUnchanged(
  held: CommissionSalaryProjectionRow | null,
  event: CommissionSalaryInputEvent,
): void {
  if (held !== null && held.businessId.toLowerCase() !== event.businessId.toLowerCase()) {
    throw new CommissionTipSalaryInputInvalidError('SALARY_IDENTITY_CHANGED');
  }
}

function nextPeriod(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}

function lastCalendarDay(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return `${period}-${String(days[month - 1]).padStart(2, '0')}`;
}
