// قاعدة إلغاء سجل انتوار الدخول الصافية (spec 076 F1): القرار بلا قاعدة بيانات ولا ساعة حقيقية —
// الوقت بيتحقن كوسيطة عشان الاختبار يبقى deterministic.

/** عمر سجل الانتظار بعده يسمح للمانح بإلغائه وحذف حسابه (FR-F1-6). */
export const PENDING_STAFF_ACCESS_CANCEL_TTL_MS = 24 * 60 * 60 * 1000;

/** صف سجل الدخول كما يقرأه use case الموظفين من جدوله. */
export interface StaffAccessRecordRow {
  readonly id: string;
  readonly state: 'PENDING' | 'ACTIVE' | 'STOPPED' | 'PHONE_CHANGING';
  readonly roleCode: 'staff' | 'reception';
  readonly branchId: string;
  readonly operationId: string;
  readonly userId: string | null;
  readonly membershipId: string | null;
  readonly createdAt: Date;
}

/**
 * هل يسمح إلغاء سجل الانتظار ده؟ PENDING فقط وبعد 24 ساعة من إنشائه (FR-F1-6): قبل كده الطلب
 * ممكن يكمل عادي بالاستئناف، وبعد كده الرقم المؤقت انتهى والسجل بقى حاجة ميّتة تتنضف.
 *
 * @param record سجل الدخول
 * @param record.state حالة السجل الحالية
 * @param record.createdAt لحظة إنشاء السجل
 * @param now اللحظة الحالية من الساعة المحقونة
 * @returns true لو الحالة PENDING وعمر السجل عدّى المدة
 */
export function pendingStaffAccessCancellable(
  record: { state: StaffAccessRecordRow['state']; createdAt: Date },
  now: Date,
): boolean {
  if (record.state !== 'PENDING') return false;
  return now.getTime() - record.createdAt.getTime() >= PENDING_STAFF_ACCESS_CANCEL_TTL_MS;
}
