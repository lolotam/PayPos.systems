import type { StaffDeviceContext, StaffSessions } from '@pospay/auth';
import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';

/** اعتماد المستخدم الموجود في الشركة؛ لا يمثل سجلاً في staff أو إثبات حضور. */
export interface StaffPinRecord {
  readonly id: string;
  readonly hash: string;
}
/** معاملة الشركة وحدها تقرأ أو تبدل الاعتماد وتكتب أثر المدير الحقيقي. */
export interface StaffPinScope {
  readonly audit: AuditTrail;
  /**
   * عضوية سارية في الشركة نفسها، دون إنشاء أو تغيير عضويات.
   *
   * @param userId المستخدم المستهدف
   */
  member(userId: string): Promise<boolean>;
  /**
   * لا تعيد PIN ولا أي بيانات مستخدم عالمي.
   *
   * @param userId صاحب الاعتماد
   */
  find(userId: string): Promise<StaffPinRecord | null>;
  /**
   * يتبدل id مع كل reset كي لا يقبل إصدار الجلسة مقارنة لاعتماد قديم.
   *
   * @param userId صاحب الاعتماد
   * @param hash الـ hash الناتج من المصادقة
   * @param actor المدير الحقيقي
   * @param at وقت التغيير
   */
  save(userId: string, hash: string, actor: string, at: Date): Promise<void>;
}
/** scope مأخوذ من الجهاز أو المدير المتحقق، وليس من body. */
export interface StaffPinTransactions {
  /**
   * actor لا يأخذ هوية الموظف إلا بعد إثبات PIN الصحيح.
   *
   * @param companyId الشركة المتحقق منها
   * @param actor الفاعل المثبت أو null قبل الإثبات
   * @param work العمل داخل المعاملة
   */
  run<T>(
    companyId: string,
    actor: string | null,
    work: (scope: StaffPinScope) => Promise<T>,
  ): Promise<T>;
}
/** الجلسة نفسها الخاصة بـ OTP، مع فحص الجهاز والعضوية على كل إصدار. */
export interface StaffPinAuthority {
  readonly sessions: StaffSessions;
  /**
   * يشترط صلاحية الدخول الفعالة في الفرع الحالي.
   *
   * @param userId صاحب الإثبات
   * @param device الجهاز المتحقق
   */
  eligible(userId: string, device: StaffDeviceContext): Promise<boolean>;
  /**
   * يعيد فحص الجهاز قبل وبعد الإصدار.
   *
   * @param device الجهاز المتحقق
   */
  deviceValid(device: StaffDeviceContext): Promise<boolean>;
  /**
   * يسحب الجلسة الجديدة إذا تبدل الإثبات قبل إصدار cookie.
   *
   * @param cookie اعتماد الجلسة الجديدة في الذاكرة فقط
   * @param device سياق الجهاز الثابت
   */
  discard(cookie: string, device: StaffDeviceContext): Promise<void>;
}
