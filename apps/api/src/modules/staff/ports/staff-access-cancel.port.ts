import type { StaffAccessRecordRow } from '../domain/staff-access.ts';
import type { StaffAccessIds } from './staff-access-begin.port.ts';

/** الشركة والمستخدم من الجلسة؛ المعاملات بتتفتح بالشركة دي والكتابة باسم المستخدم ده. */
export interface CancelPendingActor {
  /** الشركة من الجلسة. */
  readonly companyId: string;
  /** المانح الملغي من الجلسة. */
  readonly userId: string;
}

/** أمر إلغاء سجل انتظار: الموظفة والمانح من الجلسة. */
export interface CancelPendingStaffAccessCommand extends CancelPendingActor {
  /** نشاط الموظفة من المسار. */
  readonly businessId: string;
  /** الموظفة من المسار. */
  readonly employeeId: string;
}

/** نطاق إلغاء سجل الانتظار داخل معاملة الشركة: القراءة تحت القفل ثم الانتقال أو الحذف. */
export interface CancelPendingScope {
  /**
   * يقفل صف الموظفة وسجل الدخول ويرجعهما؛ null لموظفة أو سجل غير موجود.
   */
  lock(): Promise<{
    employee: {
      readonly id: string;
      readonly businessId: string;
      readonly primaryBranchId: string;
      readonly userId: string | null;
    } | null;
    record: (StaffAccessRecordRow & { readonly grantedBy: string }) | null;
  }>;
  /**
   * فحص `manage:staff-access:branch` على فرع الموظفة الأساسي جوه نفس المعاملة.
   *
   * @param businessId النشاط
   * @param branchId   الفرع الأساسي
   */
  authority(businessId: string, branchId: string): Promise<boolean>;
  /**
   * هل الفاعل يحمل عضوية مالك سارية في الشركة؟ (P1-2: الإلغاء للمانح الأصلي أو المالك).
   */
  actorIsOwner(): Promise<boolean>;
  /**
   * ينقل السجل إلى CANCELLING تحت القفل — خطوة الاستئناف الأولى؛ false لو لم يعد قابلاً للنقل.
   *
   * @param recordId معرّف السجل
   */
  markCancelling(recordId: string): Promise<boolean>;
  /**
   * يحذف سجلًا في حالة CANCELLING ويسجل الإلغاء. true حُذف أو حُذف سابقًا؛ false غيّرت حالته.
   *
   * @param recordId معرّف السجل الملغى
   */
  deleteRecord(recordId: string): Promise<boolean>;
}

/**
 * معاملة إلغاء سجل الانتظار: الانتقال إلى CANCELLING ثم (خارجها) حذف الحساب ثم الحذف النهائي.
 */
export interface CancelPendingStaffAccessSteps {
  /**
   * يفتح معاملة الإلغاء ويشغّل الشغل داخلها.
   *
   * @param actor الشركة والمانح
   * @param input نطاق الإلغاء
   * @param input.businessId النشاط
   * @param input.employeeId الموظفة
   * @param input.ids مولّد المعرّفات
   * @param input.at لحظة الساعة المحقونة
   * @param work الشغل داخل المعاملة
   */
  run<T>(
    actor: CancelPendingActor,
    input: { businessId: string; employeeId: string; ids: StaffAccessIds; at: Date },
    work: (scope: CancelPendingScope) => Promise<T>,
  ): Promise<T>;
}
