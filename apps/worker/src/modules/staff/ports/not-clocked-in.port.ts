import type { LeaveInterval, NoticeParameter } from '../domain/not-clocked-in.ts';

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

/** ما يُكتب في دفتر المنع والحدث فقط عندما يدرج الصف لأول مرة. */
export interface NoticeWrite {
  readonly shift: LockedShift;
  readonly alertAt: Date;
  readonly detectedAt: Date;
  readonly recipients: readonly string[];
  readonly parameters: readonly NoticeParameter[];
}

/** قراءات وكتابة الوظيفة على معاملة قفل الموظف. */
export interface LockedNotClockedIn {
  /**
   * يعيد قراءة الوردية الحالية؛ null إن حُذف الصف عند إعادة حفظ الأسبوع.
   *
   * @param shiftId صف الوردية الذي رأته الصفحة
   * @returns الحقائق الحالية أو null
   */
  shift(shiftId: string): Promise<LockedShift | null>;
  /**
   * إجازات الموظف المعتمدة التي تتداخل مع الوردية.
   *
   * @param employeeId الموظف
   * @param startsAt بداية الوردية
   * @param endsAt نهاية الوردية
   * @returns الإجازات المعتمدة فقط
   */
  approvedLeaves(
    employeeId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<readonly LeaveInterval[]>;
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
   * @param roles أدوار القاعدة المؤقتة
   * @returns معرفات المستخدمين بلا ترتيب مضمون بعد إزالة التكرار في SQL
   */
  managers(
    businessId: string,
    branchId: string,
    roles: readonly string[],
  ): Promise<readonly string[]>;
  /**
   * يدرج دفتر المنع مرة واحدة مع التدقيق وحدث لكل مجموعة مستلمين لا تتجاوز مئة، في نفس المعاملة.
   *
   * @param notice حقائق التنبيه والمستلمون
   * @returns true لو أُدرج الصف الآن
   */
  record(notice: NoticeWrite): Promise<boolean>;
}

/** حدود شركة واحدة؛ لا قراءة عابرة للشركات. */
export interface NotClockedInTransactions {
  /**
   * صفحة الورديات التي بدأت بما يكفي وما زالت جارية، بلا أقفال.
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
