// قاعدة إلغاء سجل انتوار الدخول الصافية (spec 076 F1): القرار بلا قاعدة بيانات ولا ساعة حقيقية —
// الوقت بيتحقن كوسيطة عشان الاختبار يبقى deterministic.

/** عمر سجل الانتظار بعده يسمح للمانح بإلغائه وحذف حسابه (FR-F1-6). */
export const PENDING_STAFF_ACCESS_CANCEL_TTL_MS = 24 * 60 * 60 * 1000;

/** صف سجل الدخول كما يقرأه use case الموظفين من جدوله. */
export interface StaffAccessRecordRow {
  readonly id: string;
  readonly state: 'PENDING' | 'ACTIVE' | 'STOPPED' | 'PHONE_CHANGING' | 'CANCELLING';
  readonly roleCode: 'staff' | 'reception';
  readonly branchId: string;
  readonly operationId: string;
  readonly userId: string | null;
  readonly membershipId: string | null;
  /** هوية محاولة المنح الحالية — الطلب القديم الذي بدأ محاولة سابقة لا يلتزم على محاولة أحدث. */
  readonly attemptId: string;
  /** لحظة بداية محاولة PENDING الحالية؛ منها تُقاس مهلة الإلغاء. */
  readonly attemptStartedAt: Date;
  /** hash الهاتف المطلوب عند إنشاء السجل — الاستئناف يقارن به بلا كشف الهاتف. */
  readonly phoneHash: string;
}

/**
 * مَن يحق له إلغاء سجل انتظار: المانح الأصلي أو مالك الشركة — لا أحد آخر (P1-2).
 *
 * @param record سجل الدخول
 * @param record.grantedBy المانح الأصلي المحفوظ على السجل
 * @param actorUserId المانح الحالي من الجلسة
 * @param actorIsOwner هل الفاعل يحمل عضوية مالك سارية
 * @returns true لو الإلغاء مسموح له
 */
export function staffAccessCancelAllowed(
  record: { grantedBy: string },
  actorUserId: string,
  actorIsOwner: boolean,
): boolean {
  return record.grantedBy === actorUserId || actorIsOwner;
}

/**
 * هل يسمح إلغاء سجل الانتظار ده؟ PENDING أو CANCELLING (استئناف إلغاء متقطع) وبعد 24 ساعة من
 * بداية المحاولة الحالية (FR-F1-6): قبل كده الطلب ممكن يكمل عادي بالاستئناف، وبعد كده الرقم
 * المؤقت انتهى. إعادة منح سجل قديم تبدأ محاولة جديدة فتبدأ مهلتها من لحظتها لا من عمر السجل.
 *
 * @param record سجل الدخول
 * @param record.state حالة السجل الحالية
 * @param record.attemptStartedAt لحظة بداية محاولة المنح الحالية
 * @param now اللحظة الحالية من الساعة المحقونة
 * @returns true لو الحالة قابلة للإلغاء وعمر المحاولة عدّى المدة
 */
export function pendingStaffAccessCancellable(
  record: { state: StaffAccessRecordRow['state']; attemptStartedAt: Date },
  now: Date,
): boolean {
  if (record.state !== 'PENDING' && record.state !== 'CANCELLING') return false;
  return now.getTime() - record.attemptStartedAt.getTime() >= PENDING_STAFF_ACCESS_CANCEL_TTL_MS;
}

/** فرع إضافي ودوره عند منح دخول الموظفة (080-b). */
export interface StaffAccessBranchAssignment {
  /** معرّف الفرع الإضافي. */
  readonly branchId: string;
  /** دور الموظفة على الفرع الإضافي — نفس قائمة الدورين المقفولة. */
  readonly role: 'staff' | 'reception';
}

/**
 * نتيجة تسوية الفروع الإضافية: الفروع المقبولة، أو رفض واحد ثابت.
 * الرفض واحد لكل أسباب التعارض عشان ما يتفضحش سبب الرفض في الرد.
 */
export type AdditionalStaffBranchesResolution =
  | { readonly ok: true; readonly branches: readonly StaffAccessBranchAssignment[] }
  | { readonly ok: false; readonly refusal: 'STAFF_ACCESS_NOT_ALLOWED' };

/**
 * يسوّي الفروع الإضافية المطلوبة قبل أي كتابة: الفرع الأساسي بنفس دوره بيتدمج (مش صف زيادة)،
 * والفرع نفسه بدورين مختلفين مرفوض، والتكرار بنفس الدور بيتخطى.
 *
 * معرّف الفرع بيتطبّع لحروف صغيرة قبل المقارنة والدمج، لأن UUID في القاعدة مش حساس لحالة
 * الأحرف: طلب فيه الفرع نفسه مكتوب بحرف كبير هو نفس الفرع، فلازم يتدمج أو يترفض بنفس القاعدة.
 *
 * @param primaryBranchId الفرع الأساسي للموظفة
 * @param primaryRole      دور الطلب على الفرع الأساسي
 * @param additionalBranches الفروع الإضافية المطلوبة كما وصلت
 * @returns الفروع المقبولة أو رفض ثابت
 */
export function resolveAdditionalStaffBranches(
  primaryBranchId: string,
  primaryRole: 'staff' | 'reception',
  additionalBranches: readonly StaffAccessBranchAssignment[] | undefined,
): AdditionalStaffBranchesResolution {
  const primary = primaryBranchId.toLowerCase();
  const seen = new Map<string, 'staff' | 'reception'>();
  for (const entry of additionalBranches ?? []) {
    const branchId = entry.branchId.toLowerCase();
    if (branchId === primary) {
      if (entry.role !== primaryRole) return { ok: false, refusal: 'STAFF_ACCESS_NOT_ALLOWED' };
      continue;
    }
    const previous = seen.get(branchId);
    if (previous === undefined) {
      seen.set(branchId, entry.role);
      continue;
    }
    if (previous !== entry.role) return { ok: false, refusal: 'STAFF_ACCESS_NOT_ALLOWED' };
  }
  return {
    ok: true,
    branches: [...seen].map(([branchId, role]) => ({ branchId, role })),
  };
}

/**
 * يقارن الفروع الإضافية المحفوظة بالمطلوبة بعد الترتيب: نفس العدد ونفس (فرع، دور) في كل موضع.
 * بترتيب مفتاح عشان ترتيب الطلب ما يغيّرش النتيجة.
 *
 * المقارنة على معرّف الفرع مطبّع لحروف صغيرة، لأن UUID في القاعدة مش حساس لحالة الأحرف.
 *
 * @param saved     الفروع المحفوظة في السجل
 * @param requested الفروع المطلوبة في الطلب
 * @returns true لو الاتنين متطابقين
 */
export function sameAdditionalStaffBranches(
  saved: readonly StaffAccessBranchAssignment[],
  requested: readonly StaffAccessBranchAssignment[],
): boolean {
  if (saved.length !== requested.length) return false;
  const byBranch = (list: readonly StaffAccessBranchAssignment[]) =>
    [...list]
      .map((entry) => ({ branchId: entry.branchId.toLowerCase(), role: entry.role }))
      .sort((a, b) => a.branchId.localeCompare(b.branchId));
  const left = byBranch(saved);
  const right = byBranch(requested);
  return left.every(
    (entry, index) =>
      entry.branchId === right[index]?.branchId && entry.role === right[index]?.role,
  );
}
