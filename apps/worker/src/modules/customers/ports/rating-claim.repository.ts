/** صف طلب التقييم كما يحتاجه قرار المطالبة، بلا أي بيانات رابط أو إرسال. */
export interface DueRatingRequest {
  readonly id: string;
  readonly businessId: string;
  readonly customerId: string;
  readonly businessDate: string;
  readonly branchId: string;
  readonly dueAt: Date;
  readonly sendDeadline: Date | null;
  readonly status: 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED';
}

/** صف العميل وقت المطالبة، وبه تفضيل الإيقاف والحقل المستعمل في الرسالة. */
export interface RatingCustomer {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly locale: 'ar' | 'en';
  readonly optedOutAt: Date | null;
}

/** آخر موضع في صفحة الطلبات؛ الصفحة الجاية تبدأ بعده فما يتكررش صف ولا يتخطى حد. */
export interface DueRatingCursor {
  readonly dueAt: Date;
  readonly id: string;
}

/** تخزين المطالبة وتثبيتها على معاملة المستأجر نفسها. */
export interface RatingClaimRepository<Transaction = unknown> {
  /**
   * يرجع صفحة الطلبات المستحقة للشركة، مرتبة بالأقدم استحقاقاً.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المالكة للطلبات
   * @param now لحظة الجولة
   * @param limit أقصى عدد طلبات في الصفحة
   * @param after آخر موضع في الصفحة اللي قبلها، أو null لأول صفحة
   * @returns الطلبات المستحقة غير المطالب بها
   */
  due(
    tx: Transaction,
    companyId: string,
    now: Date,
    limit: number,
    after: DueRatingCursor | null,
  ): Promise<readonly DueRatingRequest[]>;
  /**
   * يقفل صف العميل ويقراه؛ القفل على العميل يسبق قفل الطلب كما في مسار إيقاف الصفحة.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المالكة للعميل
   * @param customerId العميل المطلوب
   * @returns الصف المقفل أو null عند غيابه
   */
  lockCustomer(
    tx: Transaction,
    companyId: string,
    customerId: string,
  ): Promise<RatingCustomer | null>;
  /**
   * يقفل صف الطلب ويقراه؛ الصف المقفل في معاملة أخرى يُتخطى بدل انتظاره.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المالكة للطلب
   * @param requestId الطلب المطلوب
   * @returns الصف المقفل أو null إذا كان صفاً مقفولاً أو غائباً
   */
  lockRequest(
    tx: Transaction,
    companyId: string,
    requestId: string,
  ): Promise<DueRatingRequest | null>;
  /**
   * يعيد جدولة الطلب بلا تغيير حالته، لأن زيارة أحدث حرّكت موعده.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المالكة للطلب
   * @param requestId الطلب المعاد جدولته
   * @param schedule الفرع والمواعيد المعاد حسابها
   * @param schedule.branchId فرع أحدث زيارة
   * @param schedule.dueAt موعد الاستحقاق المعاد حسابه
   * @param schedule.sendDeadline الموعد النهائي للإرسال أو null
   * @param at لحظة التحديث
   * @returns اكتمال التحديث
   */
  reschedule(
    tx: Transaction,
    companyId: string,
    requestId: string,
    schedule: { branchId: string; dueAt: Date; sendDeadline: Date | null },
    at: Date,
  ): Promise<void>;
  /**
   * يلغي الطلب بسبب قاعدته، والإلغاء لا يعود في بالصف.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المالكة للطلب
   * @param requestId الطلب الملغى
   * @param reason سبب الإلغاء المسموح للمطالبة
   * @param at لحظة التحديث
   * @returns اكتمال التحديث
   */
  cancel(
    tx: Transaction,
    companyId: string,
    requestId: string,
    reason: 'NO_ACTIVE_LINE' | 'PAST_DEADLINE' | 'OPTED_OUT' | 'REQUESTS_OFF',
    at: Date,
  ): Promise<void>;
  /**
   * ينقل الطلب إلى حالة الإرسال ويثبت بصمة الرابط ووقت المطالبة وحدث الجاهزية.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المالكة للطلب
   * @param requestId الطلب المطالب به
   * @param claim الجدولة المعاد حسابها والبصمة وإصدار المفتاح ووقت المطالبة ووقت الانتهاء ومعرف حدث الجاهزية
   * @param claim.branchId فرع آخر زيارة، وهو اللي بيتكتب في الصف
   * @param claim.dueAt موعد الاستحقاق المعاد حسابه
   * @param claim.sendDeadline الموعد النهائي للإرسال أو null
   * @param claim.tokenHash بصمة الرابط المشتقة
   * @param claim.tokenKeyVersion إصدار مفتاح الاشتقاق
   * @param claim.claimedAt لحظة المطالبة
   * @param claim.expiresAt لحظة انتهاء الرابط
   * @param claim.readyEventId معرف حدث الجاهزية
   * @returns اكتمال التحديث
   */
  claim(
    tx: Transaction,
    companyId: string,
    requestId: string,
    claim: {
      branchId: string;
      dueAt: Date;
      sendDeadline: Date | null;
      tokenHash: Uint8Array;
      tokenKeyVersion: number;
      claimedAt: Date;
      expiresAt: Date;
      readyEventId: string;
    },
  ): Promise<void>;
  /**
   * يثبّت لقطة منفذي اليوم في جدول النسب، وهي لا تتغير بعد المطالبة.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المالكة للنسب
   * @param requestId الطلب المطالب به
   * @param businessId النشاط صاحب الطلب
   * @param performers المنفذون بمعرّفات الصفوف المولّدة
   * @param performers.id معرف صف النسبة
   * @param performers.employeeId معرف الموظف المنفذ
   * @returns اكتمال الإدخال
   */
  snapshotPerformers(
    tx: Transaction,
    companyId: string,
    requestId: string,
    businessId: string,
    performers: readonly { id: string; employeeId: string }[],
  ): Promise<void>;
}
