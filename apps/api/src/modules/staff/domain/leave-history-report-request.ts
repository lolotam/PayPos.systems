/** شكل الاستعلام المحلي المتوافق بنيوياً مع العقد دون ربط قاعدة العمل بالحزمة الخارجية. */
export interface LeaveHistoryReportRequest {
  readonly from: string;
  readonly to: string;
  readonly 'types[]': readonly string[];
  readonly 'statuses[]': readonly string[];
  readonly branch_id?: string | undefined;
}

/** شكل الاستعلام المخزن بعد توحيد ترتيبه ومدخلاته. */
export type LeaveHistoryReportStoredQuery = LeaveHistoryReportRequest;

/** مجموعات الفروع السبع المجمدة مع الطلب، بقراءة فقط داخل قاعدة العمل. */
export interface LeaveHistoryReportStoredScope {
  readonly branches: readonly string[];
  readonly attendanceBranches: readonly string[];
  readonly cancelBranches: readonly string[];
  readonly decideBranches: readonly string[];
  readonly revokeBranches: readonly string[];
  readonly createBranches: readonly string[];
  readonly eligibilityBranchIds: readonly string[];
}

/** هوية طلب التقرير المأخوذة من الجلسة والمسار، لا من حقول يدّعيها العميل. */
export interface LeaveHistoryReportActor {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
}

/** مدخل تجميد النطاق الحي قبل حفظه مع طلب التقرير. */
export interface LeaveHistoryReportAccess {
  readonly branches: readonly string[];
  readonly attendanceBranches: readonly string[];
  readonly cancelBranches: readonly string[];
  readonly decideBranches: readonly string[];
  readonly revokeBranches: readonly string[];
  readonly createBranches: readonly string[];
  readonly eligibilityDays?: readonly { readonly branchId: string }[];
}

/** مواعيد صف الطلب المعلق المحسوبة من لحظة واحدة حتى لا تتباين مرجعيته وحدود عمره. */
export interface PendingLeaveHistoryReport {
  readonly id: string;
  readonly asOf: string;
  readonly deadlineAt: string;
  readonly expiresAt: string;
}

/** مدخل الإدراج الكامل بعد تثبيت الاستعلام والنطاق ومصدر البصمة. */
export interface LeaveHistoryReportPendingInsert extends PendingLeaveHistoryReport {
  readonly query: LeaveHistoryReportStoredQuery;
  readonly scope: LeaveHistoryReportStoredScope;
  readonly fingerprintSource: string;
}

/** مهلة المعالجة التي يتوقف بعدها الطلب المعلق عن الدخول في إعادة الاستخدام أو الحد الأقصى. */
export const LEAVE_HISTORY_REPORT_DEADLINE_MS = 600_000;
/** أقصى عدد تقارير معلقة حية لصانع الطلب في النشاط الواحد. */
export const LEAVE_HISTORY_REPORT_MAX_PENDING = 3;

/**
 * يوحّد الاستعلام قبل بصمته وتخزينه حتى لا تُنشئ اختلافات الترتيب أو التكرار أو حالة UUID تقريراً مزدوجاً.
 *
 * @param request استعلام التقرير بعد التحقق من عقده
 * @returns الاستعلام القانوني المرتب بلا مفاتيح فرع غير موجودة
 */
export function normalizeLeaveHistoryReportQuery(
  request: LeaveHistoryReportRequest,
): LeaveHistoryReportStoredQuery {
  return {
    from: request.from,
    to: request.to,
    'types[]': [...new Set(request['types[]'])].sort(),
    'statuses[]': [...new Set(request['statuses[]'])].sort(),
    ...(request.branch_id === undefined ? {} : { branch_id: request.branch_id.toLowerCase() }),
  };
}

/**
 * يجمّد مجموعات الفروع السبع لأن تغيير الصلاحية لاحقاً يجب أن يغيّر بصمة الطلب بدل إعادة نتيجة قديمة.
 *
 * @param access نتيجة فحص القراءة الحية داخل معاملة القبول
 * @returns نطاق التقرير المخزن مع مجموعات مرتبة ومعرفات أهلية مستخلصة
 */
export function freezeLeaveHistoryReportScope(
  access: LeaveHistoryReportAccess,
): LeaveHistoryReportStoredScope {
  return {
    branches: [...access.branches].sort(),
    attendanceBranches: [...access.attendanceBranches].sort(),
    cancelBranches: [...access.cancelBranches].sort(),
    decideBranches: [...access.decideBranches].sort(),
    revokeBranches: [...access.revokeBranches].sort(),
    createBranches: [...access.createBranches].sort(),
    eligibilityBranchIds: [...new Set((access.eligibilityDays ?? []).map((day) => day.branchId))].sort(),
  };
}

/**
 * يبني JSON قانونياً بترتيب مفاتيح ثابت حتى تتساوى بصمات المدخلات المتكافئة دلالياً.
 *
 * @param query الاستعلام الموحّد المحفوظ
 * @param scope نطاق الفروع المجمّد المحفوظ
 * @returns النص الوحيد الذي تحسبه persistence إلى SHA-256
 */
export function leaveHistoryReportFingerprintSource(
  query: LeaveHistoryReportStoredQuery,
  scope: LeaveHistoryReportStoredScope,
): string {
  return JSON.stringify({
    query: {
      from: query.from,
      to: query.to,
      'types[]': query['types[]'],
      'statuses[]': query['statuses[]'],
      ...(query.branch_id === undefined ? {} : { branch_id: query.branch_id }),
    },
    scope: {
      branches: scope.branches,
      attendanceBranches: scope.attendanceBranches,
      cancelBranches: scope.cancelBranches,
      decideBranches: scope.decideBranches,
      revokeBranches: scope.revokeBranches,
      createBranches: scope.createBranches,
      eligibilityBranchIds: scope.eligibilityBranchIds,
    },
  });
}

/**
 * يحسب مرجعية التقرير وحدّ معالجته وانتهاء احتفاظه من لحظة القبول نفسها.
 *
 * @param id هوية التقرير المولدة عبر المنفذ
 * @param at لحظة القبول القادمة من Clock
 * @param retentionMs مدة الاحتفاظ بالتقرير الممررة من إعداد العقد
 * @returns هوية الصف ومواعيده الثلاثة بصيغة ISO
 */
export function pendingLeaveHistoryReport(
  id: string,
  at: Date,
  retentionMs: number,
): PendingLeaveHistoryReport {
  const timestamp = at.getTime();
  return {
    id,
    asOf: at.toISOString(),
    deadlineAt: new Date(timestamp + LEAVE_HISTORY_REPORT_DEADLINE_MS).toISOString(),
    expiresAt: new Date(timestamp + retentionMs).toISOString(),
  };
}

/** رفض قبول متوقع يحافظ على الرمز الآمن الذي يحوّله HTTP دون كشف نطاق آخر. */
export class LeaveHistoryReportRequestError extends Error {
  /**
   * يحتفظ بسبب الرفض المستقل عن تفاصيل العضوية أو التقرير.
   *
   * @param code رمز رفض القبول المعتمد
   */
  constructor(readonly code: 'NOT_FOUND' | 'FEATURE_DISABLED' | 'LEAVE_HISTORY_REPORT_BUSY') {
    super(code);
    this.name = 'LeaveHistoryReportRequestError';
  }
}
