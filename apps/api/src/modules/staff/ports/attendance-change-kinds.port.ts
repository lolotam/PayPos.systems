import type { ManualSessionPlan } from '../domain/manual-attendance-session.ts';
import type { AttendanceChangePlan } from '../domain/attendance-change-request.ts';

/** الأنواع تتوسع في شرائح التطبيق التالية دون تغيير دورة الطلب. */
export type AttendanceChangeKindCode = 'ADD_SESSION' | 'VOID_SESSION';
/** مغلف النوع يحمل أوقات وفرع الإضافة أو جلسة الإلغاء. */
export interface AttendanceChangeKindInput {
  kind: AttendanceChangeKindCode;
  employee_id: string;
  reason: string;
  /** فرع اليوم اليدوي لفحص الأهلية التاريخية. */
  branch_id?: string | undefined;
  /** بداية اليوم اليدوي كوقت مطلق. */
  clock_in?: string | undefined;
  /** نهاية اليوم اليدوي المطلوبة بلا استراحات. */
  clock_out?: string | undefined;
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
  /** معرّف يولّد قبل التطبيق لربط الجلسة بطلب المالك المباشر. */
  requestId: string;
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
  /** القيم المثبتة وقت تقديم الطلب. */
  manual?: { clock_in: string; clock_out: string; working_date: string; timezone: string };
  /** لقطة الوردية والتأخير المحسوبة تحت القفل للتطبيق. */
  manualPlan?: ManualSessionPlan;
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
/** السجل يمنع انتظار طلب لنوع لم تصل شريحته بعد. */
export interface AttendanceChangeKinds {
  /**
   * يعيد مخطط النوع أو غيابه لرفض الطلب قبل أي كتابة.
   *
   * @param kind نوع التغيير
   */
  find(kind: AttendanceChangeKindCode): AttendanceChangeKind | null;
}
export const ATTENDANCE_CHANGE_KINDS = Symbol('ATTENDANCE_CHANGE_KINDS');
