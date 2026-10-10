import type { AttendanceChangePlan } from '../domain/attendance-change-request.ts';

/** الأنواع تتوسع في شرائح التطبيق التالية دون تغيير دورة الطلب. */
export type AttendanceChangeKindCode = 'ADD_SESSION' | 'VOID_SESSION' | 'RESTORE_SESSION';
/** مغلف مشترك؛ نوع الإلغاء أو الاسترجاع يثبت معرّف الجلسة ونسختها قبل التطبيق. */
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
  /** معرّف محجوز قبل التطبيق ليربط إلغاء المالك بالطلب الذي سيُحفظ في نفس المعاملة. */
  requestId: string;
  target: AttendanceChangeTarget;
  input: AttendanceChangeKindInput;
  now: Date;
  request: AttendanceChangePlan | null;
}
/** حقائق الجلسة التي يثبتها النوع بعد فحصه. */
export interface AttendanceChangeKindValues {
  session_id: string | null;
  session_revision: number | null;
  /** أوقات الجلسة وتوقيتها لعرض مضمون الطلب في القائمة والرد. */
  requested?: {
    working_date: string;
    clock_in: string;
    clock_out: string | null;
    timezone: string;
  } | null;
  /** الجلسة بعد تطبيق الموافقة؛ غياب الأثر يعني أن الحضور لم يتغير. */
  effect?: {
    session: {
      id: string;
      working_date: string;
      clock_in: string;
      clock_out: string | null;
      status: 'OPEN' | 'CLOSED' | 'MISSED_OUT';
      revision: number;
      voided_at: string | null;
      voided_by: string | null;
      void_request_id: string | null;
    };
  } | null;
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
    scope: Omit<AttendanceChangeKindScope, 'target' | 'request' | 'requestId'>,
  ): Promise<AttendanceChangeTarget | null>;
  /**
   * يقفل صفوف النوع بترتيب ADR-0028 قبل أخذ عينة الساعة المعتمدة للقرار.
   *
   * @param scope سياق الأقفال؛ عينة الوقت الأولية لا تُستخدم للقرار
   */
  lock?(scope: Omit<AttendanceChangeKindScope, 'request'>): Promise<void>;
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
/** يسجل الأنواع المنفذة فقط حتى لا ينتظر طلب لنوع لم تصل شريحته بعد. */
export interface AttendanceChangeKinds {
  /**
   * يعيد مخطط النوع أو غيابه لرفض الطلب قبل أي كتابة.
   *
   * @param kind نوع التغيير
   */
  find(kind: AttendanceChangeKindCode): AttendanceChangeKind | null;
}
export const ATTENDANCE_CHANGE_KINDS = Symbol('ATTENDANCE_CHANGE_KINDS');
