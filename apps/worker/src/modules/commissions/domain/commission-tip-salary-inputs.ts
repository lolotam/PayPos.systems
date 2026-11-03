import { parseMoney, type Money } from '@pospay/domain';

/** طريقة دفع البقشيش: الكارت داخل صافي الكشف والكاش للعلم فقط. */
export type CommissionTipMethod = 'CASH' | 'CARD';

/** بند بقشيش قادم من حدث الجلسة؛ المبلغ نص بالدينار كما في العقد. */
export interface CommissionTipInputEntry {
  readonly employeeId: string;
  readonly method: CommissionTipMethod;
  readonly amount: string;
}

/** حدث تغيير بقشيش الجلسة؛ هويته وتاريخه متحقَّقان قبل هذا الملف. */
export interface CommissionTipInputEvent {
  readonly businessId: string;
  readonly branchId: string;
  readonly sessionId: string;
  readonly businessDate: string;
  readonly revision: number;
  readonly tips: readonly CommissionTipInputEntry[];
}

/** صف بقشيش واحد في إسقاط الجلسة. */
export interface CommissionTipProjectionRow {
  readonly employeeId: string;
  readonly method: CommissionTipMethod;
  readonly amount: Money;
}

/** إسقاط بقشيش جلسة: المراجعة المحفوظة لها وتاريخها وصفوف البقشيش. */
export interface CommissionTipProjectionSession {
  readonly sessionId: string;
  readonly branchId: string;
  readonly businessDate: string;
  readonly revision: number;
  readonly rows: readonly CommissionTipProjectionRow[];
}

/** نتيجة تخفيض حدث البقشيش: هل طُبِّق، وإسقاط الجلسة بعده. */
export interface CommissionTipProjectionOutcome {
  readonly applied: boolean;
  readonly session: CommissionTipProjectionSession | null;
}

/** حدث تغيير راتب؛ نشاط الموظفة محسوم قبل هذا الملف (FR-018b). */
export interface CommissionSalaryInputEvent {
  readonly businessId: string;
  readonly employeeId: string;
  readonly effectiveFrom: string;
  readonly amount: string;
  readonly revision: number;
}

/** صف راتب واحد في إسقاط العمولة. */
export interface CommissionSalaryProjectionRow {
  readonly employeeId: string;
  readonly effectiveFrom: string;
  readonly amount: Money;
  readonly revision: number;
}

/** نتيجة تخفيض حدث الراتب: هل طُبِّق، وصف الراتب بعده. */
export interface CommissionSalaryProjectionOutcome {
  readonly applied: boolean;
  readonly row: CommissionSalaryProjectionRow | null;
}

/** مدخل بقشاش أو راتب غير صالح؛ المبلغ المشوّه يوقف الحدث عند منتجه (FR-017) ولا يصير صفراً. */
export class CommissionTipSalaryInputInvalidError extends Error {
  readonly code = 'COMMISSION_TIP_SALARY_INPUT_INVALID';
  readonly reason: string;

  /**
   * يحتفظ بسبب الرفض حتى يصلح المنتج الحدث بدل ضياعه.
   *
   * @param reason سبب الرفض الثابت
   */
  constructor(reason: string) {
    super(`Invalid commission tip or salary input: ${reason}`);
    this.name = 'CommissionTipSalaryInputInvalidError';
    this.reason = reason;
  }
}

/**
 * يطبّق حدث بقشيش الجلسة على إسقاط البقشيش (CM-18).
 * المراجعة الأحدث تستبدل كل صفوف البقشيش السابقة للجلسة، والمراجعة المساوية أو الأقدم
 * ما بتعملش حاجة، والمجموعة الفارغة في مراجعة أحدث بتمسح البقشيش وبتسيب الرأس بالمراجعة الجديدة.
 *
 * @param sessions إسقاطات الجلسات المحفوظة الآن
 * @param event حدث البقشيش بمراجعته ومجموعته الكاملة
 * @returns هل طُبِّق الحدث، وإسقاط الجلسة بعده
 */
export function reduceCommissionTips(
  sessions: readonly CommissionTipProjectionSession[],
  event: CommissionTipInputEvent,
): CommissionTipProjectionOutcome {
  const held = sessions.find((session) => session.sessionId === event.sessionId);
  if (event.revision <= (held?.revision ?? 0)) {
    return { applied: false, session: null };
  }
  const rows: CommissionTipProjectionRow[] = [];
  const seen = new Set<string>();
  for (const tip of event.tips) {
    // مفتاح الصف هو الموظفة وطريقة الدفع، وتكرارهما معناه منتج بيطلّع مجموعتين لنفس البقشيش.
    const key = rowKey([tip.employeeId, tip.method]);
    if (seen.has(key)) throw new CommissionTipSalaryInputInvalidError('DUPLICATE_TIP_ENTRY');
    seen.add(key);
    rows.push({
      employeeId: tip.employeeId,
      method: tip.method,
      amount: parseInputAmount(tip.amount, 'MALFORMED_TIP_AMOUNT'),
    });
  }
  const session: CommissionTipProjectionSession = {
    sessionId: event.sessionId,
    branchId: event.branchId,
    businessDate: event.businessDate,
    revision: event.revision,
    rows,
  };
  return { applied: true, session };
}

/**
 * يطبّق حدث الراتب على إسقاط الرواتب (CM-19).
 * الراتب مستقل لكل موظفة ولكل تاريخ سريان: المراجعة الأحدث تستبدل الصف، والمساوية أو الأقدم
 * ما بتعملش حاجة، ووصول الأحداث بأي ترتيب بيوصل لنفس الصف.
 *
 * @param rows صفوف الرواتب المحفوظة الآن
 * @param event حدث الراتب بمراجعته وتاريخ سريانه
 * @returns هل طُبِّق الحدث، وصف الراتب بعده
 */
export function reduceCommissionSalaries(
  rows: readonly CommissionSalaryProjectionRow[],
  event: CommissionSalaryInputEvent,
): CommissionSalaryProjectionOutcome {
  const key = rowKey([event.employeeId, event.effectiveFrom]);
  const held = rows.find((row) => rowKey([row.employeeId, row.effectiveFrom]) === key);
  if (event.revision <= (held?.revision ?? 0)) {
    return { applied: false, row: null };
  }
  const row: CommissionSalaryProjectionRow = {
    employeeId: event.employeeId,
    effectiveFrom: event.effectiveFrom,
    amount: parseInputAmount(event.amount, 'MALFORMED_SALARY_AMOUNT'),
    revision: event.revision,
  };
  return { applied: true, row };
}

/**
 * يحوّل مبلغ نصي بالدينار إلى فلوس، ويرفض المبلغ المشوّه بدل ما يتحوّل لصفر.
 * المبلغ المشوّه خطأ عند المنتج (FR-017)، فالحدث يتوقف حتى يُصلَح بدل ما يضيع.
 *
 * @param amount المبلغ النصي كما وصل من الحدث
 * @param reason سبب الرفض اللي الخطأ يحمله
 * @returns المبلغ بالفلوس
 */
function parseInputAmount(amount: string, reason: string): Money {
  try {
    return parseMoney(amount);
  } catch (error) {
    if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
    throw new CommissionTipSalaryInputInvalidError(reason);
  }
}

/**
 * يبني مفتاح صف من هوياته بحروف صغيرة، عشان المقارنة بين الصفوف ما تتأثرش بحالة الحرف.
 *
 * @param parts هويات الصف بالترتيب
 * @returns مفتاح نصي للمقارنة
 */
function rowKey(parts: readonly string[]): string {
  return parts.join('|').toLowerCase();
}
