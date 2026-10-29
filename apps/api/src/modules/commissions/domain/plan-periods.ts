import { CommissionPlanVersionError } from './errors.ts';

export type CommissionStatementStatus = 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID';

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
 * يطبق قاعدة FR-007 بعد قفل الشهور: التاريخ العادي لا يكون في الماضي، وشهر whole_period
 * يجب أن يكون DRAFT، والشهر المغلق يمنع الكتابة، وكل REVIEWED لاحق يعود إلى DRAFT.
 *
 * @param input تاريخ السريان ونوع الإصدار وتاريخ النشاط والشهور المقفولة
 * @returns الشهور اللاحقة التي يجب إرجاعها إلى DRAFT في المعاملة نفسها
 */
export function assertCommissionPlanEffectiveFrom(input: {
  readonly effectiveFrom: string;
  readonly wholePeriod: boolean;
  readonly today: string;
  readonly locked: readonly CommissionPlanStatementPeriod[];
}): string[] {
  if (!input.wholePeriod && input.effectiveFrom < input.today) {
    throw new CommissionPlanVersionError('COMMISSION_EFFECTIVE_FROM_PAST');
  }
  const ownMonth = input.effectiveFrom.slice(0, 7);
  const own = input.locked.find(({ period }) => period === ownMonth);
  if (input.wholePeriod && own?.status === 'REVIEWED') {
    throw new CommissionPlanVersionError('COMMISSION_PERIOD_NOT_DRAFT');
  }
  if (input.wholePeriod && (own?.status === 'APPROVED' || own?.status === 'PAID')) {
    throw new CommissionPlanVersionError('COMMISSION_PERIOD_CLOSED');
  }
  const later = input.locked.filter(({ period }) => period > ownMonth);
  if (later.some(({ status }) => status === 'APPROVED' || status === 'PAID')) {
    throw new CommissionPlanVersionError('COMMISSION_PERIOD_CLOSED');
  }
  return later.filter(({ status }) => status === 'REVIEWED').map(({ period }) => period);
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
