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
  readonly createdAt: Date;
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
 * إنشائه (FR-F1-6): قبل كده الطلب ممكن يكمل عادي بالاستئناف، وبعد كده الرقم المؤقت انتهى.
 *
 * @param record سجل الدخول
 * @param record.state حالة السجل الحالية
 * @param record.createdAt لحظة إنشاء السجل
 * @param now اللحظة الحالية من الساعة المحقونة
 * @returns true لو الحالة قابلة للإلغاء وعمر السجل عدّى المدة
 */
export function pendingStaffAccessCancellable(
  record: { state: StaffAccessRecordRow['state']; createdAt: Date },
  now: Date,
): boolean {
  if (record.state !== 'PENDING' && record.state !== 'CANCELLING') return false;
  return now.getTime() - record.createdAt.getTime() >= PENDING_STAFF_ACCESS_CANCEL_TTL_MS;
}
