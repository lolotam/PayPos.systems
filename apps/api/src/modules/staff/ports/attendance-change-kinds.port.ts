import type { AttendanceChangePlan } from '../domain/attendance-change-request.ts';

/** الأنواع تتوسع في شرائح التطبيق التالية دون تغيير دورة الطلب. */
export type AttendanceChangeKindCode = 'ADD_SESSION' | 'VOID_SESSION';
/** مغلف النوع قبل إضافة حقول الإضافة والإلغاء في شريحتيهما. */
export interface AttendanceChangeKindInput {
  kind: AttendanceChangeKindCode;
  employee_id: string;
  reason: string;
  session_id?: string | undefined;
  session_revision?: number | undefined;
}
/** هدف موثوق من قراءة النوع الأولية قبل قفل حالة الموظف. */
export interface AttendanceChangeTarget {
  employee_id: string;
  branch_id: string;
}
/** قدرة معاملة معتمة؛ محول النوع وحده يفسرها داخل طبقة التخزين. */
export interface AttendanceChangeKindScope {
  transaction: unknown;
  companyId: string;
  businessId: string;
  userId: string;
  target: AttendanceChangeTarget;
  input: AttendanceChangeKindInput;
  now: Date;
  request: AttendanceChangePlan | null;
}
/** حقائق الجلسة التي يثبتها النوع بعد فحصه. */
export interface AttendanceChangeKindValues {
  session_id: string | null;
  session_revision: number | null;
}
/** مخطط نوع التغيير؛ الفحص والتطبيق يعملان على نفس معاملة القرار. */
export interface AttendanceChangeKind {
  code: AttendanceChangeKindCode;
  /**
   * يقرأ الموظف والفرع لفحص السلطة دون أقفال أو كتابة.
   *
   * @param scope سياق الطلب الأولي
   */
  target(
    scope: Omit<AttendanceChangeKindScope, 'target' | 'request'>,
  ): Promise<AttendanceChangeTarget | null>;
  /**
   * يعيد القيم المثبتة بعد مراجعة قواعد النوع تحت الأقفال عند الطلب والموافقة.
   *
   * @param scope الحقائق المقفولة
   */
  check(scope: AttendanceChangeKindScope): Promise<AttendanceChangeKindValues>;
  /**
   * يطبق الأثر داخل المعاملة الحالية ويعيد الجلسة الناتجة إن وجدت.
   *
   * @param scope الحقائق والمعاملة المشتركة
   * @param values نتيجة فحص النوع
   */
  apply(
    scope: AttendanceChangeKindScope,
    values: AttendanceChangeKindValues,
  ): Promise<AttendanceChangeKindValues>;
}
/** السجل الفارغ يمنع انتظار طلب لنوع لم تصل شريحته بعد. */
export interface AttendanceChangeKinds {
  /**
   * يعيد مخطط النوع أو غيابه لرفض الطلب قبل أي كتابة.
   *
   * @param kind نوع التغيير
   */
  find(kind: AttendanceChangeKindCode): AttendanceChangeKind | null;
}
export const ATTENDANCE_CHANGE_KINDS = Symbol('ATTENDANCE_CHANGE_KINDS');
