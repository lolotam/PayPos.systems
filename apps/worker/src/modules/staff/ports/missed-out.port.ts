import type { MissedOutSession } from '../domain/missed-out.ts';

/** موضع الصفحة التالية بترتيب ثابت (clock_in ثم id) حتى لا تتكرر جلسة أو تسقط بين الصفحات. */
export interface MissedOutCursor {
  readonly clockIn: Date;
  readonly id: string;
}

/** الجلسة المفتوحة كما قُرئت بعد قفل State، مع النطاق اللازم لكتابة الاستثناء والحدث. */
export interface LockedMissedOutSession extends MissedOutSession {
  readonly businessId: string;
  readonly branchId: string;
}

/** كتابات الوظيفة على نفس معاملة القفل؛ اللحظات تأتي محسوبة من domain. */
export interface LockedAttendance {
  /** جلسة الموظف المفتوحة الآن أو null إن سبق مسحٌ وأقفلها. */
  readonly open: LockedMissedOutSession | null;
  /**
   * يرفع SUSPECTED_MISSED_OUT مع تدقيقه وحدثه مرة واحدة فقط للجلسة.
   *
   * @param session الجلسة المقفولة
   * @param dueAt لحظة الاستحقاق التي حسبها domain
   * @param at لحظة الاكتشاف
   * @returns true لو رُفع الآن، false لو كان مرفوعاً من قبل
   */
  raiseSuspected(session: LockedMissedOutSession, dueAt: Date, at: Date): Promise<boolean>;
  /**
   * يقفل الجلسة MISSED_OUT عند الحد ويحل الاشتباه المفتوح مع التدقيق والحدث.
   *
   * @param session الجلسة المقفولة
   * @param closeAt حد ١٦ ساعة (AT-Q6)
   * @param at لحظة الاكتشاف المسجلة منفصلة
   * @returns true لو أقفلت الآن، false لو لم تعد مفتوحة
   */
  closeMissedOut(session: LockedMissedOutSession, closeAt: Date, at: Date): Promise<boolean>;
}

/** حدود المعاملات داخل شركة واحدة فقط؛ لا قراءة عابرة للشركات. */
export interface MissedOutTransactions {
  /**
   * يرجع صفحة الجلسات المفتوحة المرشحة بلا قفل، كي لا يمسك المسح الطويل أقفال الموظفين.
   *
   * @param companyId الشركة المجدولة
   * @param clockInAtOrBefore أحدث clock-in قد يستحق خطوة
   * @param after موضع الصفحة السابقة
   * @param limit حجم الصفحة
   * @returns المرشحون مع علامة الاشتباه المرفوع
   */
  candidates(
    companyId: string,
    clockInAtOrBefore: Date,
    after: MissedOutCursor | null,
    limit: number,
  ): Promise<readonly MissedOutSession[]>;
  /**
   * يقفل State الموظف أولاً (نفس ترتيب المسح)، ثم يعيد قراءة الجلسة ويأخذ الوقت مرة واحدة.
   *
   * @param companyId الشركة المجدولة
   * @param employeeId الموظف المرشح
   * @param sample أخذ لحظة القرار بعد القفل
   * @param work القرار والكتابة تحت القفل
   * @returns نتيجة العمل بعد commit
   */
  run<T>(
    companyId: string,
    employeeId: string,
    sample: () => Date,
    work: (tx: LockedAttendance, at: Date) => Promise<T>,
  ): Promise<T>;
}
