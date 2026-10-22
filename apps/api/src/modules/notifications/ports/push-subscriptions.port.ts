/** اشتراك حيّ كما هو في الشركة: بصمة التثبيت وبصمة الوجهة وصاحبها. */
export interface LivePushSubscription {
  readonly id: string;
  readonly userId: string;
  readonly installationHash: string;
  readonly endpointHash: string;
  readonly createdAt: Date;
}

/** القيم اللي بتتخزّن في اشتراك جديد أو متجدّد. */
export interface PushSubscriptionWrite {
  readonly id: string;
  readonly installationHash: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly endpointHash: string;
  readonly deliveryToken: string;
  readonly locale: 'ar' | 'en';
  readonly vapidKeyId: string;
  readonly now: Date;
}

/** عمليات اشتراكات الدفع جوه معاملة شركة واحدة. */
export interface PushSubscriptionStore {
  /**
   * بيقفل المستخدمين بأقفال تعاونية بترتيب المعرف الصاعد، عشان تسجيلين متسابقين ما يسيبوش اتنين صفوف حيّين.
   *
   * @param userIds المعرفات اللي تتقفل
   */
  lockUsers(userIds: readonly string[]): Promise<void>;
  /**
   * بيجيب كل الاشتراكات الحيّة للمستخدم في الشركة.
   *
   * @param userId صاحب الاشتراكات
   * @returns صفوف الاشتراكات الحيّة
   */
  findCallerLive(userId: string): Promise<readonly LivePushSubscription[]>;
  /**
   * بيجيب كل الاشتراكات الحيّة اللي وجهتها نفس الوجهة، لمين ما كان صاحبها.
   *
   * @param endpointHash بصمة الوجهة
   * @returns صفوف الاشتراكات الحيّة
   */
  findLiveByEndpoint(endpointHash: string): Promise<readonly LivePushSubscription[]>;
  /**
   * بيسحب صف حيّ ويمسح أسراره ويزوّد عدّاده.
   *
   * @param id     الصف
   * @param reason سبب السحب
   * @param now    وقت السحب
   */
  revoke(id: string, reason: string, now: Date): Promise<void>;
  /**
   * بيكتب اشتراك التثبيت: ينشئه أو يحدّث صفه ويشيل سبب السحب لو كان مسحوب.
   *
   * @param row قيم الاشتراك
   */
  upsert(row: PushSubscriptionWrite): Promise<void>;
  /**
   * بيسحب اشتراك التثبيت للمستخدم لو كان حيّ، والغائب أو الغريب ما بيغيّرش حاجة.
   *
   * @param userId           صاحب الاشتراك
   * @param installationHash بصمة التثبيت
   * @param reason           سبب السحب
   * @param now              وقت السحب
   */
  revokeByInstallation(
    userId: string,
    installationHash: string,
    reason: string,
    now: Date,
  ): Promise<void>;
}

/** معاملة واحدة لكل شغل اشتراكات الدفع في شركة. */
export interface PushSubscriptionTransactions {
  /**
   * بيشغّل شغل الاشتراكات كله في transaction واحدة للشركة، عشان القفل والقرار والكتابة يتعملوا سوا.
   *
   * @param target الشركة والمستخدم
   * @param work   الشغل جوه الـ transaction
   * @returns اللي الشغل رجّعه بعد الـ commit
   */
  run<T>(
    target: { companyId: string; userId: string },
    work: (store: PushSubscriptionStore) => Promise<T>,
  ): Promise<T>;
}
