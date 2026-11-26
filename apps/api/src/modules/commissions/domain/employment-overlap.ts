/** تواريخ عمل الموظفة كما يقرؤها الاعتماد: التعيين، ونهاية العقد، ويوم الحذف بتاريخ النشاط المحلي. */
export interface EmploymentDates {
  /** أول يوم عمل، بصيغة YYYY-MM-DD. */
  readonly hireDate: string;
  /** آخر يوم في العقد إن وُجد، بصيغة YYYY-MM-DD. */
  readonly contractEnd: string | null;
  /** يوم الحذف بتاريخ النشاط المحلي إن حُذفت الموظفة، بصيغة YYYY-MM-DD؛ التحويل من اللحظة يتم في المحوّل لا هنا. */
  readonly deletedOn: string | null;
}

const MONTH = /^(\d{4})-(\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value: string): void {
  if (!DATE.test(value)) throw new RangeError(`Invalid employment date: ${value}`);
}

/**
 * يفكّ الشهر YYYY-MM لسنة ورقم شهر، ويرفض الصيغة أو الشهر غير الصالح، عشان القاعدتين يشتركوا في نفس التحقق.
 *
 * @param period الشهر بصيغة YYYY-MM
 * @returns السنة ورقم الشهر (1 إلى 12)
 * @throws RangeError لشهر بصيغة غير صالحة
 */
function parsePeriod(period: string): { year: number; month: number } {
  const match = MONTH.exec(period);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (match === null || year === 0 || month < 1 || month > 12) {
    throw new RangeError(`Invalid commission period: ${period}`);
  }
  return { year, month };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * بيحدد هل الموظفة سابت الشغل قبل شهر الكشف (CM-50، CS-Q28): نهاية عقدها أو يوم حذفها المحلي قبل أول يوم في
 * الشهر بالظبط. القاعدة هنا في domain/ عشان ما تتكرر في الاستعلام ولا في الشاشة؛ والشاشة بتعرض العلامة بس.
 *
 * @param dates نهاية العقد ويوم الحذف المحلي، كل واحد منهم YYYY-MM-DD أو null
 * @param period الشهر بصيغة YYYY-MM
 * @returns true لو انتهى عقدها أو اتحذفت قبل أول يوم في الشهر
 * @throws RangeError لشهر أو تاريخ بصيغة غير صالحة
 */
export function employeeLeftBeforeMonth(
  dates: Pick<EmploymentDates, 'contractEnd' | 'deletedOn'>,
  period: string,
): boolean {
  parsePeriod(period);
  if (dates.contractEnd !== null) assertDate(dates.contractEnd);
  if (dates.deletedOn !== null) assertDate(dates.deletedOn);
  const firstDay = `${period}-01`;
  return (
    (dates.contractEnd !== null && dates.contractEnd < firstDay) ||
    (dates.deletedOn !== null && dates.deletedOn < firstDay)
  );
}

/**
 * يحدد هل عمل الموظفة يتقاطع مع شهر الكشف، وهو شرط دخولها كشف الشهر المجمّد بسطر EMPLOYEE بصفر
 * وشرط أن يُرحَّل رصيدها السالب إلى الشهر التالي: الموظفة التي لا يتقاطع عملها مع الشهر لا تُرحَّل مرة ثانية (D-22، CS-Q8، CS-Q28).
 * القاعدة: تاريخ التعيين ≤ آخر يوم في الشهر، ونهاية العقد والحذف إن وُجدا ≥ أول يوم فيه. الحدّان شاملان.
 *
 * @param dates تواريخ العمل المقروءة من الموظفين (التعيين، نهاية العقد، يوم الحذف المحلي)
 * @param period الشهر بصيغة YYYY-MM
 * @returns true إن كان عملها يتقاطع مع يوم واحد على الأقل من الشهر
 * @throws RangeError لشهر أو تاريخ بصيغة غير صالحة
 */
export function employmentOverlapsMonth(dates: EmploymentDates, period: string): boolean {
  const { year, month } = parsePeriod(period);
  assertDate(dates.hireDate);
  if (dates.contractEnd !== null) assertDate(dates.contractEnd);
  if (dates.deletedOn !== null) assertDate(dates.deletedOn);
  const firstDay = `${period}-01`;
  const lastDay = `${period}-${String(lastDayOfMonth(year, month)).padStart(2, '0')}`;
  return (
    dates.hireDate <= lastDay &&
    (dates.contractEnd === null || dates.contractEnd >= firstDay) &&
    (dates.deletedOn === null || dates.deletedOn >= firstDay)
  );
}
