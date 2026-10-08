import type {
  AttendanceExceptionChange,
  AttendanceExceptionRecord,
} from '../domain/attendance-exception.ts';

/** هوية المدير المتحقق منها؛ الفرع يُؤخذ من صف الاستثناء لا من الطلب. */
export interface AttendanceExceptionActor {
  companyId: string;
  userId: string;
  businessId: string;
  exceptionId: string;
  key: string;
  fingerprint: string;
}
/** الساعة المشتركة لسلطة العضوية ووقت الإغلاق المسجل. */
export interface AttendanceExceptionClock {
  /** لحظة للفحص الأولي ثم لحظة جديدة بعد الأقفال لتثبيت السلطة ووقت القرار. */ now(): Date;
}
/** نطاق المعاملة بعد قفل الصف والتحقق من سلطة فرعه. */
export interface AttendanceExceptionScope {
  /** لحظة واحدة بعد انتظار الأقفال. */ now: Date;
  employeeUserId: string | null;
  before: AttendanceExceptionRecord;
  /**
   * يحفظ الانتقال والتدقيق داخل المعاملة ذاتها.
   *
   * @param change الصف الجديد وسبب هذا القرار
   */
  save(change: AttendanceExceptionChange): Promise<void>;
}
/** حد المعاملة يثبت السلطة قبل إعادة الرد ويمنع تكرار التأثير. */
export interface AttendanceExceptionTransactions {
  /**
   * يفحص سلطة الفرع بلا أقفال، ثم يقفل الشركة والعضويات والاستثناء والموظف ويعيد التحقق قبل الأثر.
   *
   * @param actor الفاعل المتحقق منه
   * @param action الإغلاق أو إعادة الفتح
   * @param clock الساعة المحقونة للفحص الأولي ثم القرار النهائي بعد الأقفال
   * @param work العمل داخل حد المعاملة
   */
  run(
    actor: AttendanceExceptionActor,
    action: 'resolve' | 'reopen',
    clock: AttendanceExceptionClock,
    work: (scope: AttendanceExceptionScope) => Promise<AttendanceExceptionRecord>,
  ): Promise<AttendanceExceptionRecord>;
}
