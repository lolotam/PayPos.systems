import type { LeaveInterval, NoticeParameter, PresenceSession } from '../domain/not-clocked-in.ts';
import type { SelfParameter } from '../domain/not-clocked-in-self.ts';
import type { AlertRulesPort } from './alert-rule.port.ts';

/** موضع الصفحة التالية بترتيب (starts_at ثم id) حتى لا تتكرر وردية أو تسقط بين الصفحات. */
export interface NotClockedInCursor {
  readonly startsAt: Date;
  readonly id: string;
}

/** وردية مرشحة من القراءة بلا قفل؛ القرار الملزم يعاد تحت قفل State. */
export interface DueShift {
  readonly id: string;
  readonly employeeId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** الوردية والموظف والفرع كما أُعيدت قراءتهم بعد القفل. */
export interface LockedShift {
  readonly id: string;
  readonly employeeId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly workingDate: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly deleted: boolean;
  readonly contractEnd: string | null;
  readonly employeeUserId: string | null;
  readonly nameAr: string | null;
  readonly nameEn: string;
  readonly branchNameAr: string | null;
  readonly branchNameEn: string;
  readonly timeZone: string;
}

/** إشعار الدفع للموظفة بنفسها: المستخدم اللي بيتحمل الرسالة ومعاملات قالبها. */
export interface EmployeePush {
  readonly userId: string;
  readonly parameters: readonly SelfParameter[];
}

/** ما يُكتب في دفتر المنع والحدث فقط عندما يدرج الصف لأول مرة. */
export interface NoticeWrite {
  readonly shift: LockedShift;
  readonly alertAt: Date;
  readonly detectedAt: Date;
  readonly recipients: readonly string[];
  readonly parameters: readonly NoticeParameter[];
  /** هدف الإشعار الثابت للموظفة الغائبة: بيتحمل على أول حدث من التنبيه بس؛ الإشعار نفسه بيسافر في طلبه هو (BR-008). */
  readonly employeePushUserId: string | null;
  /** إشعار الدفع اللي بتبعتاه الموظفة بنفسها، أو null لو مفيش هدفش أو صلاحيتها الشخصية مش سارية. */
  readonly employeePush: EmployeePush | null;
}

/** سطر الدفتر اللي بيتكتب والقاعدة مقفولة: سطر دفتر بلا إشعار (spec 060 D-B15). */
export interface SuppressedWrite {
  readonly shift: LockedShift;
  readonly alertAt: Date;
  readonly detectedAt: Date;
}

/** قراءات وكتابة الوظيفة على معاملة قفل الموظف. */
export interface LockedNotClockedIn {
  /** القاعدة الفعلية لنوع التنبيه، تُقرأ على نفس معاملة القفل. */
  readonly rules: AlertRulesPort;
  /**
   * يعيد قراءة الوردية الحالية؛ null إن حُذف الصف عند إعادة حفظ الأسبوع.
   *
   * @param shiftId صف الوردية الذي رأته الصفحة
   * @returns الحقائق الحالية أو null
   */
  shift(shiftId: string): Promise<LockedShift | null>;
  /**
   * إجازات الموظف المعتمدة: يومية تغطي يوم العمل أو أي إجازة تتداخل لحظياً مع الوردية لتكملة السلسلة.
   *
   * @param employeeId الموظف
   * @param startsAt بداية الوردية
   * @param endsAt نهاية الوردية
   * @param workingDate يوم بداية الوردية، لإعفاء الليلي بالإجازة اليومية
   * @returns الإجازات المعتمدة فقط
   */
  approvedLeaves(
    employeeId: string,
    startsAt: Date,
    endsAt: Date,
    workingDate: string,
  ): Promise<readonly LeaveInterval[]>;
  /**
   * جلسة من أي فرع كانت مفتوحة لحظة التنبيه؛ الإغلاق اللاحق لا يمحو حضور الوردية الثانية.
   *
   * @param employeeId الموظف
   * @param alertAt لحظة التنبيه بعد تطبيق الإجازات
   * @returns حقائق جلسة تغطي لحظة التنبيه أو null
   */
  presenceSession(employeeId: string, alertAt: Date): Promise<PresenceSession | null>;
  /**
   * لحظات الحضور داخل النافذة، من أي فرع.
   *
   * @param employeeId الموظف
   * @param from أول لحظة شاملة
   * @param to آخر لحظة شاملة
   * @returns لحظات clock-in
   */
  clockIns(employeeId: string, from: Date, to: Date): Promise<readonly Date[]>;
  /**
   * مستخدمو العضويات النشطة التي تغطي فرع الوردية بالأدوار المعطاة.
   *
   * @param businessId نشاط الوردية
   * @param branchId فرع الوردية
   * @param roles أدوار القاعدة الفعلية
   * @returns معرفات المستخدمين بلا ترتيب مضمون بعد إزالة التكرار في SQL
   */
  managers(
    businessId: string,
    branchId: string,
    roles: readonly string[],
  ): Promise<readonly string[]>;
  /**
   * هل للمستخدم المرتبط عضوية سارية تغطّي الشركة أو نشاط الموظفة أو فرع من فروعها في يوم الوردية؟
   * عضوية منتهية أو مغطّاش النطاق معناها إن صلاحيته في الشغل انتهت، فمفيش إشعار يوصلها (ADR-0052 §5).
   *
   * @param userId المستخدم
   * @param shift الوردية المقفولة: نشاط الموظفة وفروعها
   * @param at لحظة القرار
   * @returns true لو العضوية سارية وتغطّي النطاق
   */
  userHasAccess(userId: string, shift: LockedShift, at: Date): Promise<boolean>;
  /**
   * يدرج دفتر المنع مرة واحدة مع التدقيق وحدث لكل مجموعة مستلمين لا تتجاوز مئة، في نفس المعاملة.
   *
   * @param notice حقائق التنبيه والمستلمون
   * @returns true لو أُدرج الصف الآن
   */
  record(notice: NoticeWrite): Promise<boolean>;
  /**
   * يدرج سطر دفتر واحد والقاعدة مقفولة: بلا تدقيق وبلا حدث وبلا مستلمين.
   *
   * @param notice لحظات الاستحقاق والكشف
   * @returns true لو أُدرج الصف الآن
   */
  suppress(notice: SuppressedWrite): Promise<boolean>;
}

/** حدود شركة واحدة؛ لا قراءة عابرة للشركات. */
export interface NotClockedInTransactions {
  /**
   * صفحة الورديات الجارية بلا إشعار سابق لشركة غير محذوفة، بلا أقفال.
   * البداية أيضاً بعد endsAfter ناقص ١٦ ساعة، لأن قيد مدة الوردية يمنع أطول من ذلك.
   *
   * @param companyId الشركة المجدولة
   * @param startsAtOrBefore أحدث بداية مستحقة
   * @param endsAfter الورديات التي تنتهي بعد هذه اللحظة فقط، وهي مرساة حد الست عشرة ساعة
   * @param after موضع الصفحة السابقة
   * @param limit حجم الصفحة
   * @returns المرشحون
   */
  candidates(
    companyId: string,
    startsAtOrBefore: Date,
    endsAfter: Date,
    after: NotClockedInCursor | null,
    limit: number,
  ): Promise<readonly DueShift[]>;
  /**
   * يقفل State الموظف أولاً، ثم يأخذ الساعة مرة واحدة، ثم ينفذ القرار.
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
    work: (tx: LockedNotClockedIn, at: Date) => Promise<T>,
  ): Promise<T>;
}

/** تشخيص فشل الوردية مع استمرار باقي المرشحين وإعادة المحاولة لاحقاً. */
export interface NotClockedInDiagnostics {
  /**
   * يسجل نوع السبب ورمزه الآمنين فقط؛ الرسالة والبيانات الشخصية لا تُطبع.
   *
   * @param companyId الشركة المجدولة
   * @param error سبب فشل المعاملة قبل تنقيحه في المحول
   */
  failed(companyId: string, error: unknown): void;
}
