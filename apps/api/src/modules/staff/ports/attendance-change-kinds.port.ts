import type { AttendanceChangePlan } from '../domain/attendance-change-request.ts';

/** ترمي الأنواع هذا الرفض؛ تتراجع المعاملة ويظل الطلب PENDING حتى يمكن معالجة السبب. */
export class AttendanceChangeKindRefusal extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 422;

  /**
   * يثبت كود الرفض وحالته حتى يصل سبب رفض النوع للعميل دون تحويله لخطأ تخزين.
   *
   * @param code كود سبب رفض النوع
   * @param status حالة الرد التي تميز الرفض المتوقع
   */
  constructor(code: string, status: 400 | 403 | 404 | 409 | 422) {
    super(code);
    this.name = 'AttendanceChangeKindRefusal';
    this.code = code;
    this.status = status;
  }
}

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
  /** معرّف الطلب؛ مخصص قبل المعاملة عند التقديم، وصفه موجود فعلاً وقت التطبيق فقط. */
  requestId: string;
  request: AttendanceChangePlan | null;
}
/** سياق التطبيق؛ صف الطلب محفوظ PENDING بالمعرّف requestId في المعاملة نفسها، فيصح ربط الأثر به بمفتاح أجنبي. */
export interface AttendanceChangeApplyScope extends AttendanceChangeKindScope {
  request: AttendanceChangePlan;
}
/** حقائق الجلسة التي يثبتها النوع بعد فحصه. */
export interface AttendanceChangeKindValues {
  session_id: string | null;
  session_revision: number | null;
}
/** مخطط نوع التغيير؛ الفحص والتطبيق يشتركان في المعاملة ويرميان AttendanceChangeKindRefusal لرفضها وإبقاء الطلب PENDING. */
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
   * يعيد القيم المثبتة بعد مراجعة قواعد النوع تحت الأقفال عند الطلب والموافقة.
   *
   * @param scope الحقائق المقفولة
   */
  check(scope: AttendanceChangeKindScope): Promise<AttendanceChangeKindValues>;
  /**
   * يطبق الأثر داخل المعاملة الحالية ويعيد معرّف الجلسة الناتجة، أو null للاحتفاظ بهدف الطلب.
   * صف الطلب محفوظ قبله دائماً، حتى في خطوة المالك الواحدة، فيقدر النوع يكتب change_request_id أو void_request_id = scope.requestId.
   *
   * @param scope الحقائق والمعاملة المشتركة ومعرّف الطلب المحفوظ
   * @param values نتيجة فحص النوع
   */
  apply(
    scope: AttendanceChangeApplyScope,
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
