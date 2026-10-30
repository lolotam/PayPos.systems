import { CommissionPlanVersionError } from './errors.ts';

/** حالة كشف العمولة الشهري، وتحدّد هل ما زال الشهر قابلاً للتعديل أم صار مغلقاً مالياً. */
export type CommissionStatementStatus = 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID';

/** يربط شهر النشاط بكشفه وحالته، لأن قرار الإصدار يُتخذ على أساس كل شهر على حدة. */
export interface CommissionPlanStatementPeriod {
  readonly period: string;
  readonly statementId: string;
  readonly status: CommissionStatementStatus;
}

const MONTH = /^(\d{4})-(\d{2})$/;

function monthIndex(period: string): number {
  const match = MONTH.exec(period);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (match === null || year === 0 || month < 1 || month > 12) {
    throw new RangeError(`Invalid commission period: ${period}`);
  }
  return year * 12 + month - 1;
}

function periodAt(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * يحسب كل الشهور التي قد تتأثر بإصدار الخطة، من شهر سريانه حتى شهر النشاط الحالي تصاعدياً.
 * ترتيب النتيجة هو ترتيب الأقفال الإلزامي، والإصدار المستقبلي لا يحتاج قفل أي شهر.
 *
 * @param effectiveFrom تاريخ سريان الإصدار بصيغة YYYY-MM-DD
 * @param today تاريخ النشاط الحالي بصيغة YYYY-MM-DD
 * @returns الشهور بصيغة YYYY-MM مرتبة تصاعدياً، وقد تكون فارغة
 */
export function commissionPlanMonthsToLock(effectiveFrom: string, today: string): string[] {
  const start = monthIndex(effectiveFrom.slice(0, 7));
  const end = monthIndex(today.slice(0, 7));
  const periods: string[] = [];
  for (let current = start; current <= end; current += 1) periods.push(periodAt(current));
  return periods;
}

/**
 * يحسب الشهور التي لم تُقفل بعد عند تغير شهر النشاط أثناء انتظار الأقفال.
 * الشهور المطلوبة الجديدة تلي الأقفال السابقة، فيظل ترتيب القفل تصاعدياً وفق D-3.
 *
 * @param effectiveFrom تاريخ سريان الإصدار بصيغة YYYY-MM-DD
 * @param today تاريخ النشاط بعد آخر عينة من الساعة بصيغة YYYY-MM-DD
 * @param locked الشهور التي أخذ الكاتب أقفالها بالفعل
 * @returns الشهور الناقصة فقط بصيغة YYYY-MM مرتبة تصاعدياً، وقد تكون فارغة
 */
export function commissionPlanMonthsStillToLock(
  effectiveFrom: string,
  today: string,
  locked: readonly string[],
): string[] {
  const alreadyLocked = new Set(locked);
  return commissionPlanMonthsToLock(effectiveFrom, today).filter(
    (period) => !alreadyLocked.has(period),
  );
}

function assertOrdinaryEffectiveFromNotPast(input: {
  readonly effectiveFrom: string;
  readonly wholePeriod: boolean;
  readonly today: string;
}): void {
  if (!input.wholePeriod && input.effectiveFrom < input.today) {
    throw new CommissionPlanVersionError('COMMISSION_EFFECTIVE_FROM_PAST');
  }
}

/**
 * يرفض التاريخ العادي الماضي، ويرفض شهر whole_period الأقدم من شهر إنشاء النشاط
 * لأن ما قبل وجود النشاط لا يحتوي مبيعات يمكن للإصدار تصحيحها.
 * يعمل الفحص قبل lockPeriods لأن القفل ينشئ كشف DRAFT لكل شهر في النطاق؛ والتاريخ العادي
 * الماضي يظل ماضياً بعد الانتظار لأن الوقت يتحرك للأمام فقط.
 * قاعدة بداية النشاط لا تحتاج إعادة فحص بعد انتظار الأقفال لأن تاريخ إنشاء النشاط ثابت،
 * والمقارنة لا تعتمد على اليوم أو على شهر قد يتغير أثناء الانتظار.
 *
 * @param input تاريخ السريان ونوع الإصدار وتاريخ النشاط وشهر إنشائه
 * @param input.effectiveFrom تاريخ سريان الإصدار بصيغة YYYY-MM-DD
 * @param input.wholePeriod هل يغطي الإصدار شهر سريانه بالكامل
 * @param input.today تاريخ اليوم في منطقة النشاط بصيغة YYYY-MM-DD
 * @param input.businessStartMonth شهر إنشاء النشاط في منطقته الزمنية بصيغة YYYY-MM
 * @returns لا شيء؛ يرمي COMMISSION_EFFECTIVE_FROM_PAST أو COMMISSION_PERIOD_BEFORE_BUSINESS عند الرفض
 */
export function assertCommissionPlanDateBeforeLocks(input: {
  readonly effectiveFrom: string;
  readonly wholePeriod: boolean;
  readonly today: string;
  readonly businessStartMonth: string;
}): void {
  assertOrdinaryEffectiveFromNotPast(input);
  if (input.wholePeriod && input.effectiveFrom.slice(0, 7) < input.businessStartMonth) {
    throw new CommissionPlanVersionError('COMMISSION_PERIOD_BEFORE_BUSINESS');
  }
}

/**
 * يطبق قاعدة FR-007 بعد قفل الشهور: التاريخ العادي لا يكون في الماضي، والشهر المغلق
 * يمنع النوعين، وشهر whole_period يجب أن يكون DRAFT، وكل REVIEWED لاحق يعود إلى DRAFT.
 * شهر REVIEWED الخاص بالإصدار العادي يعود أيضاً إلى DRAFT.
 *
 * @param input تاريخ السريان ونوع الإصدار وتاريخ النشاط والشهور المقفولة
 * @param input.effectiveFrom تاريخ سريان الإصدار بصيغة YYYY-MM-DD
 * @param input.wholePeriod هل يغطي الإصدار شهر سريانه بالكامل
 * @param input.today تاريخ اليوم في منطقة النشاط بصيغة YYYY-MM-DD
 * @param input.locked حالات الشهور بعد أخذ أقفالها
 * @returns شهور REVIEWED المطلوب إرجاعها إلى DRAFT، بما فيها شهر الإصدار العادي، تصاعدياً
 */
export function assertCommissionPlanEffectiveFrom(input: {
  readonly effectiveFrom: string;
  readonly wholePeriod: boolean;
  readonly today: string;
  readonly locked: readonly CommissionPlanStatementPeriod[];
}): string[] {
  assertOrdinaryEffectiveFromNotPast(input);
  const ownMonth = input.effectiveFrom.slice(0, 7);
  const own = input.locked.find(({ period }) => period === ownMonth);
  if (own?.status === 'APPROVED' || own?.status === 'PAID') {
    throw new CommissionPlanVersionError('COMMISSION_PERIOD_CLOSED');
  }
  if (input.wholePeriod && own?.status === 'REVIEWED') {
    throw new CommissionPlanVersionError('COMMISSION_PERIOD_NOT_DRAFT');
  }
  const later = input.locked.filter(({ period }) => period > ownMonth);
  if (later.some(({ status }) => status === 'APPROVED' || status === 'PAID')) {
    throw new CommissionPlanVersionError('COMMISSION_PERIOD_CLOSED');
  }
  const reviewed = later.filter(({ status }) => status === 'REVIEWED').map(({ period }) => period);
  return !input.wholePeriod && own?.status === 'REVIEWED' ? [ownMonth, ...reviewed] : reviewed;
}

/**
 * يخصص رقم الإصدار التالي للموظفة بعد قراءة أعلى رقم تحت قفل صفها.
 *
 * @param previousMax أعلى رقم محفوظ، أو null عندما لا توجد إصدارات سابقة
 * @returns 1 لأول إصدار، وإلا الرقم السابق زائداً واحداً
 */
export function nextCommissionPlanVersion(previousMax: number | null): number {
  if (previousMax !== null && (!Number.isInteger(previousMax) || previousMax < 1)) {
    throw new RangeError('The previous commission plan version is invalid');
  }
  return previousMax === null ? 1 : previousMax + 1;
}
