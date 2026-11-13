import type {
  LeaveHistoryItem,
  LeaveHistoryPage,
  LeaveHistoryQuery,
  LeaveHistoryReportRequest,
  LeaveHistoryReportStatus,
} from '@pospay/contracts';

export type LeaveReportScope = { companyId: string; businessId: string; userId: string };

export type LeaveReportStatus = 'loading' | 'preparing' | 'failed' | 'error' | 'ready';

/** جسم الطلب الصارم: هو نفسه عقد التقارير، فأي مفتاح زيادة بيرفضه السيرفر، فمفيش employee_id ولا cursor ولا limit. */
export type LeaveReportBody = LeaveHistoryReportRequest;

export type LeaveReportPageData = {
  items: LeaveHistoryItem[];
  next_cursor: string | null;
  absence_branch_ids: string[];
  last_taken: LeaveHistoryPage['last_taken'];
};

export type LeaveReportView = {
  status: LeaveReportStatus;
  page?: LeaveReportPageData;
  error?: unknown;
  lastTaken?: LeaveHistoryPage['last_taken'];
  fetching: boolean;
  cursor: string | undefined;
  setCursor: (cursor: string | undefined) => void;
  apply: (query: LeaveHistoryQuery) => void;
  chooseEmployee: (employeeId: string) => void;
  query: LeaveHistoryQuery;
  employeeId: string;
};

export type ReportViewInput = {
  syncPending: boolean;
  syncError: unknown;
  postError: unknown;
  jobError: unknown;
  jobStatus: LeaveHistoryReportStatus | undefined;
};

export type ReportViewState = { status: LeaveReportStatus; error?: unknown };

const REPORT_REQUIRED_CODE = 'LEAVE_HISTORY_REPORT_REQUIRED';
const VALIDATION_FAILED_CODE = 'VALIDATION_FAILED';

/**
 * كائن بسيط بخصائص معروفة: عشان نفحص غلاف الخطأ من غير cast.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * قائمة عناصر من غير نوع معروف: عشان نفحص تفاصيل الخطأ من غير cast.
 */
function isUnknownList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * الرفض الثقيل بيتعرف بالكود اللي جاي في الظرف مش برقم الحالة؛ رقم 422 نفسه مش دليل.
 */
export function isReportRequired(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return code === REPORT_REQUIRED_CODE;
}

/**
 * المؤشر المنتهي: السيرفر بيرفض مؤشر القراءة السريعة الأقدم من يوم بـ VALIDATION_FAILED
 * وتفاصيل على مسار cursor، وده معناه إن الصفحة المفروضة ترجع لأول صفحة.
 */
export function isExpiredCursor(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error['code'] !== VALIDATION_FAILED_CODE) return false;
  const details = error['details'];
  if (!isUnknownList(details)) return false;
  return details.some((detail) => {
    if (!isRecord(detail)) return false;
    const path = detail['path'];
    return isUnknownList(path) && path[0] === 'cursor';
  });
}

/**
 * المدخل مخول لما يقرأ 200 أو لما السيرفر يرد بالرفض الثقيل، لأن الرفض بيتبعت بعد كل اختبارات الصلاحية.
 */
export function isAccessProof(result: { isSuccess: boolean; error: unknown }): boolean {
  return result.isSuccess || isReportRequired(result.error);
}

/**
 * جسم طلب التقرير الثقيل: الفترة والأنواع والحالات والفرع بس، من غير موظفة ولا cursor ولا limit، لأن السيرفر بيرفض أي مفتاح زيادة.
 */
export function toReportBody(query: LeaveHistoryQuery): LeaveReportBody {
  return {
    from: query.from,
    to: query.to,
    'types[]': query['types[]'],
    'statuses[]': query['statuses[]'],
    ...(query.branch_id ? { branch_id: query.branch_id } : {}),
  };
}

/**
 * حالة الشاشة الواحدة: القراءة السريعة جاهزة، والقراءة الثقيلة بتجهز لحد ما التقرير يخلص أو يفشل.
 */
export function reportViewState(input: ReportViewInput): ReportViewState {
  if (!isReportRequired(input.syncError)) {
    if (input.syncError) return { status: 'error', error: input.syncError };
    return { status: input.syncPending ? 'loading' : 'ready' };
  }
  if (input.postError) return { status: 'error', error: input.postError };
  if (input.jobError) return { status: 'error', error: input.jobError };
  if (input.jobStatus?.status === 'failed')
    return { status: 'failed', error: input.jobStatus.error };
  if (input.jobStatus?.status === 'ready') return { status: 'ready' };
  return { status: 'preparing' };
}

/**
 * صفحة العرض: صفحة التقرير المخزن أول، لأنها الأحدث، وبعدها صفحة القراءة السريعة.
 */
export function reportPage(
  syncPage: LeaveHistoryPage | undefined,
  jobStatus: LeaveHistoryReportStatus | undefined,
): LeaveReportPageData | undefined {
  if (jobStatus?.status === 'ready') {
    return {
      items: jobStatus.items,
      next_cursor: jobStatus.next_cursor,
      absence_branch_ids: jobStatus.absence_branch_ids,
      last_taken: jobStatus.last_taken,
    };
  }
  if (syncPage === undefined) return undefined;
  return {
    items: syncPage.items,
    next_cursor: syncPage.next_cursor,
    absence_branch_ids: syncPage.absence_branch_ids,
    last_taken: syncPage.last_taken,
  };
}

/**
 * سطر آخر إجازة بيتحسب مع الموظفة بس، فالتقرير المخزن مالوش سطر.
 */
export function reportLastTaken(
  syncPage: LeaveHistoryPage | undefined,
  employeeId: string,
): LeaveHistoryPage['last_taken'] | undefined {
  if (syncPage === undefined || employeeId === '') return undefined;
  return syncPage.last_taken;
}
