import { t, type Locale, type MessageKey } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';

/** كود رفض السيرفر لكل رسالة مقروءة؛ الأكواد دي ما بتتعرضش للمستخدم أبدًا. */
const CODE_KEYS: Record<string, MessageKey> = {
  COMMISSION_STATEMENT_BLOCKED: 'commissionStatementScreen.errBlocked',
  COMMISSION_UPDATES_PENDING: 'commissionStatementScreen.errUpdatesPending',
  COMMISSION_COVERAGE_NOT_PROVEN: 'commissionStatementScreen.errCoverageNotProven',
  FEATURE_DISABLED: 'commissionStatementScreen.errFeatureDisabled',
  COMMISSION_FINGERPRINT_STALE: 'commissionStatementScreen.errStale',
  COMMISSION_PERIOD_CLOSED: 'commissionStatementScreen.errPeriodClosed',
  COMMISSION_STATEMENT_NOT_REVIEWED: 'commissionStatementScreen.errNotReviewed',
  COMMISSION_PERIOD_NOT_DRAFT: 'commissionStatementScreen.errNotDraft',
  COMMISSION_PERIOD_NOT_ENDED: 'commissionStatementScreen.errNotEnded',
  COMMISSION_RETURN_REASON_INVALID: 'commissionStatementScreen.errReturnReason',
  COMMISSION_STATEMENT_NOT_APPROVED: 'commissionStatementScreen.errNotApproved',
  COMMISSION_STATEMENT_ALREADY_PAID: 'commissionStatementScreen.errAlreadyPaid',
  COMMISSION_PAID_ON_INVALID: 'commissionStatementScreen.errPaidOnInvalid',
  COMMISSION_PAYABLE_TOO_LARGE: 'commissionStatementScreen.errPayableTooLarge',
  FORBIDDEN: 'commissionStatementScreen.errForbidden',
  IDEMPOTENCY_KEY_IN_PROGRESS: 'commissionStatementScreen.errBusy',
};

/** رفض معناه إن حالة الكشف اتغيّرت عن اللي المستخدم شافه، فالحل تحميله من جديد. */
const RELOAD_CODES: ReadonlySet<string> = new Set([
  'COMMISSION_FINGERPRINT_STALE',
  'COMMISSION_STATEMENT_NOT_APPROVED',
  'COMMISSION_STATEMENT_ALREADY_PAID',
]);

/** مشكلة موقوفة جاية في تفاصيل الرفض: الموظفة وسبب المنع. */
export interface FailureIssue {
  employeeId: string;
  code: string;
}

/** رفض الكشف جاهز للعرض: النص، وقائمة المشاكل، وعدد بنود الخدمة الناقصة، وهل لازم تحميل من جديد. */
export interface StatementFailure {
  code: string | null;
  text: string;
  issues: FailureIssue[];
  lineCount: number;
  stale: boolean;
}

function issuesOf(details: unknown): FailureIssue[] {
  const list = (details as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const entry = item as { employee_id?: unknown; code?: unknown };
    return typeof entry.employee_id === 'string' && typeof entry.code === 'string'
      ? [{ employeeId: entry.employee_id, code: entry.code }]
      : [];
  });
}

function lineCountOf(details: unknown): number {
  const ids = (details as { line_ids?: unknown } | null)?.line_ids;
  return Array.isArray(ids) ? ids.length : 0;
}

/**
 * يحوّل رفض السيرفر لرسالة مقروءة بلغة الشاشة: الكود المعروف له نصه، وأي كود تاني ليه رسالة الغلاف نفسها،
 * ورد من غير غلاف (انقطاع شبكة مثلًا) بياخد الرسالة العامة.
 * `FEATURE_DISABLED` ممكن يجي من ميزة العمولات أو من مفتاح الاعتماد، والرد ما بيفرّقش بينهم، فرسالته
 * واحدة وما بتسمّيش أيّهم.
 *
 * @param error الرفض زي ما رماه عميل الكشف
 * @param locale لغة الشاشة
 * @returns الرسالة وتفاصيل المشاكل
 */
export function statementFailure(error: unknown, locale: Locale): StatementFailure {
  const body = (error ?? {}) as { code?: unknown; details?: unknown };
  const code = typeof body.code === 'string' ? body.code : null;
  const key = code === null ? undefined : CODE_KEYS[code];
  const hasEnvelope = code !== null;
  return {
    code,
    text: key !== undefined
      ? t(locale, key)
      : hasEnvelope
        ? envelopeMessage(error, locale)
        : t(locale, 'commissionStatementScreen.errGeneric'),
    issues: issuesOf(body.details),
    lineCount: lineCountOf(body.details),
    stale: code !== null && RELOAD_CODES.has(code),
  };
}

/** مفتاح نص مشكلة الموظفة في عرض الكشف أو في تفاصيل الرفض. */
export function issueKey(code: string): MessageKey {
  return code === 'NO_SALARY'
    ? 'commissionStatementScreen.issueNoSalary'
    : 'commissionStatementScreen.issueNoPlan';
}
