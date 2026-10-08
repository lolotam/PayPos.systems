import type { CorrectAttendanceResult } from '@pospay/contracts';
import type {
  AttendanceCorrectionNeighbour,
  AttendanceCorrectionPlan,
  AttendanceCorrectionSession,
} from '../domain/attendance-correction.ts';

/** هوية المدير المتحقق منها؛ الفرع يُؤخذ من صف الجلسة لا من الطلب. */
export interface AttendanceCorrectionActor {
  companyId: string;
  userId: string;
  businessId: string;
  sessionId: string;
  key: string;
  fingerprint: string;
}
/** الساعة المشتركة لسلطة العضوية ولحظة التصحيح المسجلة. */
export interface AttendanceCorrectionClock {
  /** لحظة للفحص الأولي ثم لحظة جديدة بعد الأقفال لتثبيت السلطة ووقت التصحيح. */
  now(): Date;
}
/** نطاق المعاملة بعد قفل حالة الموظف والجلسة والتحقق من سلطة فرعها. */
export interface AttendanceCorrectionScope {
  /** لحظة واحدة بعد انتظار الأقفال. */
  now: Date;
  owner: boolean;
  employeeUserId: string | null;
  session: AttendanceCorrectionSession;
  neighbours: readonly AttendanceCorrectionNeighbour[];
  /**
   * يحفظ التصحيح والتدقيق داخل المعاملة ذاتها ويعيد عقد الرد المشترك لإعادة المفتاح.
   *
   * @param plan القيم الجديدة وصفوف الحقول التي تغيّرت
   */
  save(plan: AttendanceCorrectionPlan): Promise<CorrectAttendanceResult>;
}
/** حد المعاملة يثبت السلطة قبل إعادة الرد ويمنع تكرار التأثير. */
export interface AttendanceCorrectionTransactions {
  /**
   * يفحص سلطة الفرع بلا أقفال، ثم يقفل الحالة والشركة والعضويات والجلسة ويعيد التحقق قبل الأثر ورد العقد المشترك.
   *
   * @param actor الفاعل المتحقق منه
   * @param clock الساعة المحقونة للفحص الأولي ثم القرار النهائي بعد الأقفال
   * @param work العمل داخل حد المعاملة
   */
  run(
    actor: AttendanceCorrectionActor,
    clock: AttendanceCorrectionClock,
    work: (scope: AttendanceCorrectionScope) => Promise<CorrectAttendanceResult>,
  ): Promise<CorrectAttendanceResult>;
}
