import type { LeaveEmployee, LeaveRecord } from '../domain/leave-types.ts';
/** هوية وسياق متحقق منهما؛ الذات تأتي من جلسة staff وحدها. */
export interface LeaveActor {
  companyId: string;
  userId: string;
  businessId: string;
  branchId?: string;
  employeeId?: string;
  own: boolean;
  leaveId?: string;
  key: string;
  fingerprint: string;
}
/** مصادر الساعة والمعرفات المحقونة للإنشاء والإلغاء. */
export interface LeaveClock {
  /** يثبت لحظة واحدة للسلطة وأهلية الموظف والماضي وتوقيت الإنشاء أو الإلغاء. */ now(): Date;
}
/** توليد UUID v7 لا يعرفه قلب قواعد الإجازة. */
export interface LeaveIds {
  /** معرف حقنه جذر تركيب staff. */ newId(): string;
}
/** مستودع المعاملة يحمل الموظف المقفول والطلب السابق والتأثيرات الذرية. */
export interface LeaveScope {
  /** لحظة واحدة بعد انتظار الأقفال للسلطة والأهلية والفترة والتوقيت المسجل. */ now: Date;
  employee: LeaveEmployee;
  branchId: string;
  timezone: string;
  before: LeaveRecord | null;
  /**
   * فترات معلقة ومعتمدة لنفس الموظف عبر كل الفروع لمنع تعارض الإجازة.
   *
   * @param period الفترة الجديدة
   * @param period.starts_at البداية الشاملة
   *
   * @param period.ends_at النهاية المستبعدة
   */
  overlaps(period: {
    starts_at: string;
    ends_at: string;
  }): Promise<Pick<LeaveRecord, 'starts_at' | 'ends_at' | 'status'>[]>;
  /**
   * يحفظ الطلب أو إلغاءه مع التدقيق والحدث داخل المعاملة ذاتها.
   *
   * @param record نسخة الطلب
   */
  save(record: LeaveRecord): Promise<void>;
}
/** حد المعاملة يثبت السلطة قبل إعادة الرد ويمنع تكرار التأثير. */
export interface LeaveTransactions {
  /**
   * يقفل السلطة والموظف ثم يعيد المحاولة أو ينفذ الأثر مرة واحدة.
   *
   * @param actor الفاعل المتحقق منه
   * @param action العملية المطلوبة
   * @param clock الساعة المحقونة التي تُقرأ بعد انتظار الأقفال وتُشارك لحظتها مع قواعد الفترة والأهلية
   *
   * @param work العمل داخل حد المعاملة
   */
  run(
    actor: LeaveActor,
    action: 'create' | 'cancel',
    clock: LeaveClock,
    work: (scope: LeaveScope) => Promise<LeaveRecord>,
  ): Promise<LeaveRecord>;
}
