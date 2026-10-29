import {
  attendanceStatementShiftPeriodIsValid,
  attendanceStatementShiftsQuery,
  type WorkspaceBranch,
} from '@pospay/contracts';
import {
  attendanceStatementErrorsAr,
  attendanceStatementErrorsEn,
  attendanceStatementRenderErrors,
  localDate,
  t,
  type Locale,
} from '@pospay/i18n';
import { boardAccessLost } from './attendance-board-display';

export type StatementForm = 'BRANCH' | 'EMPLOYEE';

export type StatementPeriod = { from: string; to: string };

export type StatementShift = { start: string; end: string };

export type StatementLanguage = 'ar' | 'en';

export type StatementDraft = {
  form: StatementForm;
  language: StatementLanguage;
  periodMode: 'month' | 'custom';
  month: string;
  from: string;
  to: string;
  employeeId: string;
  shift: StatementShift | undefined;
};

export type StatementDraftPatch = Partial<StatementDraft>;

export type StatementEmployee = {
  employee_id: string;
  name_ar: string | null;
  name_en: string;
  employee_number: number;
};

type StatementErrorCode = keyof typeof attendanceStatementErrorsEn;

const STATEMENT_ERROR_CODES: readonly string[] = Object.keys(attendanceStatementErrorsEn);

function errorCode(error: unknown): string | undefined {
  const value = error as { code?: unknown } | null;
  return typeof value?.code === 'string' ? value.code : undefined;
}

function errorStatus(error: unknown): number | undefined {
  const value = error as { status?: unknown } | null;
  return typeof value?.status === 'number' ? value.status : undefined;
}

function isStatementErrorCode(code: string): code is StatementErrorCode {
  return STATEMENT_ERROR_CODES.includes(code);
}

/** الرسالة بتاعة رفض معروف من كتالوج أخطاء البيان، وترجع الرسالة العامة لو الكود مش معروف. */
export function statementErrorMessage(error: unknown, locale: Locale): string {
  const code = errorCode(error);
  if (code !== undefined && isStatementErrorCode(code)) {
    const catalog = locale === 'ar' ? attendanceStatementErrorsAr : attendanceStatementErrorsEn;
    return catalog[code];
  }
  if (errorStatus(error) === 401) return t(locale, 'attendanceReport.sessionExpired');
  if (code === 'FEATURE_DISABLED') return t(locale, 'attendanceReport.featureDisabled');
  if (code === 'NOT_FOUND') return t(locale, 'attendanceReport.notFound');
  return t(locale, 'admin.unexpected');
}

/**
 * الرفض معناه ضياع الوصول للفرع فيفتح الشاشة من غير نموذج.
 * رفضات البيان المعروفة (404 للموظفة أو الفرع) استثناء: هي بتقول السبب، مش بتلغي الوصول.
 */
export function statementAccessLost(error: unknown): boolean {
  const code = errorCode(error);
  if (code !== undefined && isStatementErrorCode(code)) return false;
  return boardAccessLost(error);
}

/** على مسار الحالة والتحصيل الـ 404 معناه إن الـ render-id مش معروف أو خلص، مش ضياع وصول. */
export function statementRenderAccessLost(error: unknown): boolean {
  if (errorStatus(error) === 404) return false;
  return statementAccessLost(error);
}

/** رسالة رفض على مسار الحالة أو التحصيل؛ الـ 404 هناك معناه «الكشف انتهى». */
export function statementRenderErrorMessage(error: unknown, locale: Locale): string {
  if (errorStatus(error) === 404) return t(locale, 'attendanceStatementScreen.expired');
  return statementErrorMessage(error, locale);
}

/** رسالة كود فشل التجهيز؛ STATEMENT_EMPTY معروف من كتالوج الـ worker، والباقي مفاتيح الشاشة. */
export function statementRenderCodeMessage(code: string | undefined, locale: Locale): string {
  if (code === 'STATEMENT_EMPTY') {
    const render = attendanceStatementRenderErrors.STATEMENT_EMPTY;
    return locale === 'ar' ? render.message_ar : render.message_en;
  }
  if (code === 'DOCUMENT_TOO_LARGE')
    return t(locale, 'attendanceStatementScreen.DOCUMENT_TOO_LARGE');
  if (code === 'DOCUMENT_RENDER_TIMEOUT')
    return t(locale, 'attendanceStatementScreen.DOCUMENT_RENDER_TIMEOUT');
  if (code === 'DOCUMENT_RENDER_FAILED')
    return t(locale, 'attendanceStatementScreen.DOCUMENT_RENDER_FAILED');
  if (code === 'DOCUMENT_KIND_UNKNOWN')
    return t(locale, 'attendanceStatementScreen.DOCUMENT_KIND_UNKNOWN');
  return t(locale, 'admin.unexpected');
}

/** اسم الملف بينه على المتصفح: المتصفح مش بيقرا Content-Disclosure من API تانية (FR-007). */
export function statementFileName(form: StatementForm, period: StatementPeriod): string {
  const kind = form === 'EMPLOYEE' ? 'employee' : 'branch';
  return `attendance-statement-${kind}-${period.from}_${period.to}.pdf`;
}

/** أول وآخر يوم في شهر ميلادي معروف. */
export function statementMonthRange(month: string): StatementPeriod {
  const [year = 0, monthPart = 1] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, monthPart, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** الفترة الافتراضية: الشهر الحالي في توقيت الفرع مش في توقيت الجهاز. */
export function statementDefaultPeriod(timezone: string): StatementPeriod {
  return statementMonthRange(localDate(new Date(), timezone).slice(0, 7));
}

/** آخر يوم في الشهر الحالي بتوقيت الفرع — الحد اللي ما بيعديش منه `to` (Story 3.4). */
export function statementCurrentMonthEnd(timezone: string): string {
  return statementDefaultPeriod(timezone).to;
}

/** فحص مبدئي للفترة في المتصفح؛ الخادم هو المرجع النهائي. */
export function statementPeriodIsValid(period: StatementPeriod, timezone: string): boolean {
  if (!attendanceStatementShiftsQuery.safeParse(period).success) return false;
  if (!attendanceStatementShiftPeriodIsValid(period)) return false;
  return period.to <= statementCurrentMonthEnd(timezone);
}

/** الشهور اللي الفترة بتمسّها — واحد لكل شهر في التقرير الشهري (PP-74.2). */
export function statementMonthsInPeriod(period: StatementPeriod): string[] {
  const start = period.from.slice(0, 7);
  const end = period.to.slice(0, 7);
  if (start > end) return [];
  const [startYear = 0, startMonth = 1] = start.split('-').map(Number);
  const [endYear = 0, endMonth = 1] = end.split('-').map(Number);
  const months: string[] = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** اسم الموظفة بلغة العرض؛ العربي بيفضّل الاسم العربي لو موجود. */
export function statementEmployeeName(employee: StatementEmployee, locale: Locale): string {
  return locale === 'ar' ? (employee.name_ar ?? employee.name_en) : employee.name_en;
}

/** اسم الفرع بلغة العرض. */
export function statementBranchName(branch: WorkspaceBranch, locale: Locale): string {
  return locale === 'ar' ? (branch.name_ar ?? branch.name_en) : branch.name_en;
}

/** الفترة الفعلية من المسودة: شهر كامل أو من/إلى. */
export function statementPeriod(draft: StatementDraft): StatementPeriod {
  if (draft.periodMode === 'month') return statementMonthRange(draft.month);
  return { from: draft.from, to: draft.to };
}

/** المسودة الأولى: كشف الفرع للشهر الحالي بلغة الواجهة. */
export function statementInitialDraft(timezone: string, locale: StatementLanguage): StatementDraft {
  const period = statementDefaultPeriod(timezone);
  return {
    form: 'BRANCH',
    language: locale,
    periodMode: 'month',
    month: period.from.slice(0, 7),
    from: period.from,
    to: period.to,
    employeeId: '',
    shift: undefined,
  };
}

/**
 * يطبّق تعديل على المسودة.
 * تغيير الفترة بيلغي الشيفت المختار: زوج قديم في فترة جديدة بيتقبل في السيرفر وبيطلع كشف فاضي.
 */
export function statementApplyPatch(
  draft: StatementDraft,
  patch: StatementDraftPatch,
): StatementDraft {
  const next: StatementDraft = {
    form: patch.form ?? draft.form,
    language: patch.language ?? draft.language,
    periodMode: patch.periodMode ?? draft.periodMode,
    month: patch.month ?? draft.month,
    from: patch.from ?? draft.from,
    to: patch.to ?? draft.to,
    employeeId: patch.employeeId ?? draft.employeeId,
    shift: 'shift' in patch ? patch.shift : draft.shift,
  };
  const before = statementPeriod(draft);
  const after = statementPeriod(next);
  const periodChanged = before.from !== after.from || before.to !== after.to;
  if (periodChanged || patch.form === 'EMPLOYEE') next.shift = undefined;
  return next;
}

/** جسم الطلب: الشيفت بس في كشف الفرع، والموظفة بس لو متختارينها (FR-001). */
export function statementRequestBody(draft: StatementDraft, period: StatementPeriod) {
  return {
    form: draft.form,
    from: period.from,
    to: period.to,
    language: draft.language,
    ...(draft.employeeId ? { employee_id: draft.employeeId } : {}),
    ...(draft.form === 'BRANCH' && draft.shift ? { shift: draft.shift } : {}),
  };
}

/** هل الرفض معناه إن الكشف خلص ومينفعش ينتحم تاني؟ */
export function statementExpired(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'DOCUMENT_EXPIRED' || errorStatus(error) === 404 || errorStatus(error) === 410;
}

/** فشل التحصيل العابر يسمح بفحص نفس التجهيز أو بطلب جديد؛ انتهاء الكشف وفقد الوصول لهم مسارهم. */
export function statementCollectCanRecover(error: unknown): boolean {
  return Boolean(error) && !statementExpired(error) && !statementRenderAccessLost(error);
}

/**
 * هل الشاشة لازم تقفل النموذج؟
 * فحص الوصول وطلب الإنشاء بيخسروا الوصول؛ رفض المسار بس بيقول إن الـ render-id مش معروف.
 */
export function statementFormAccessLost(
  probe: unknown,
  render: unknown,
  request?: unknown,
): boolean {
  if (request && statementAccessLost(request)) return true;
  if (probe && statementAccessLost(probe)) return true;
  return Boolean(render && statementRenderAccessLost(render));
}
