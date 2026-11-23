import type { AlertKind, EffectiveAlertRule } from '@pospay/domain';
import type {
  LowRatingFacts,
  LowRatingRecipient,
  PerformerNames,
  StoredRating,
} from '../domain/low-rating-notice.ts';

/** هوية الحدث الموثوق؛ الشركة من الغلاف والباقي من الحمولة بعد تحقق العقد. */
export interface LowRatingEvent extends LowRatingFacts {
  readonly companyId: string;
  readonly sourceEventId: string;
  readonly ratingId: string;
}

/** القاعدة الفعلية لنوع تنبيه عند لحظة قرار الـ worker (BR-B5). */
export interface AlertRulePort {
  /**
   * يرجع القاعدة الفعلية لنوع تنبيه في نشاط وفرع، بالمفتاح العام مطبّقًا.
   *
   * @param companyId الشركة من الغلاف الموثوق
   * @param scope نشاط التقييم وفرعه
   * @param scope.businessId نشاط التقييم
   * @param scope.branchId فرع التقييم
   * @param kind نوع التنبيه
   * @returns القاعدة الفعلية؛ المقفولة لا مستلمين لها ولا قنوات
   */
  rule(
    companyId: string,
    scope: { businessId: string; branchId: string | null },
    kind: AlertKind,
  ): Promise<EffectiveAlertRule>;
}

/** مستلمو الجرس من identity، على معاملة المستهلك نفسها. */
export interface LowRatingRecipients {
  /**
   * يرجع مديري نطاق الفرع النشطين بالأدوار المعتمدة لحظة القرار.
   *
   * @param event نطاق التقييم الموثوق
   * @param at لحظة قرار الـ worker
   * @param roles أدوار النظام التي تسمح بها القاعدة
   * @returns معرّفات المستخدمين المرشحين
   */
  managers(event: LowRatingEvent, at: Date, roles: readonly string[]): Promise<readonly string[]>;
  /**
   * يرجع من يحق لهم قراءة التعليق من بين المرشحين؛ يُستدعى فقط لتعليق غير فارغ.
   *
   * @param event نطاق التقييم الموثوق
   * @param userIds المرشحون
   * @param at لحظة قرار الـ worker
   * @returns مجموعة جزئية من المرشحين لا يمنعها DENY
   */
  commentReaders(
    event: LowRatingEvent,
    userIds: readonly string[],
    at: Date,
  ): Promise<readonly string[]>;
}

/** أهلية الشركة واسما الفرع من tenancy. */
export interface LowRatingPlace {
  /**
   * يثبت أن الشركة مفتوحة قبل أخذ أي قرار.
   *
   * @param companyId الشركة من الغلاف الموثوق
   * @returns هل الشركة مفتوحة
   */
  companyOpen(companyId: string): Promise<boolean>;
  /**
   * يرجع اسمي الفرع أو null لما اختفى الفرع، فلا يخمّن المستهلك المكان.
   *
   * @param event نطاق التقييم الموثوق
   * @returns اسما الفرع إن وُجد
   */
  forBranch(
    event: LowRatingEvent,
  ): Promise<{ nameAr: string | null; nameEn: string | null } | null>;
}

/** دفتر القرار وقراءات التقييم داخل المستأجر. */
export interface LowRatingRepository {
  /**
   * يقرأ التقييم المحفوظ وطلبه؛ null لما لا تقييم بهذا المعرّف في الشركة.
   *
   * لا يرجع نص التعليق أبدًا، فقط هل يوجد تعليق غير فارغ، فلا يدخل النص ذاكرة الـ worker قبل القاعدة والدفتر وقراء التعليق.
   *
   * @param event هوية الحدث
   * @returns التقييم بوجود تعليقه وتاريخ النشاط ومعرّف العميل
   */
  readRating(event: LowRatingEvent): Promise<StoredRating | null>;
  /**
   * يقرأ نص التعليق في معاملة القرار نفسها؛ يُستدعى فقط بعد فوز الدفتر ووجود قارئ تعليق مخوّل واحد على الأقل.
   *
   * @param event هوية الحدث
   * @returns نص التعليق، أو null لما لا تعليق
   */
  readComment(event: LowRatingEvent): Promise<string | null>;
  /**
   * يقرأ اسم العميل وهاتفه من عميل طلب التقييم.
   *
   * @param event هوية الحدث
   * @param customerId العميل المحفوظ على الطلب
   * @returns الاسم والهاتف، أو null لما لا عميل
   */
  readCustomer(
    event: LowRatingEvent,
    customerId: string,
  ): Promise<{ name: string; phone: string } | null>;
  /**
   * يرجع منفذي لقطة التقييم بترتيب معرّف الموظف وأسماءهم الأولى؛ الموظف بلا اسم آمن يبقى بأسماء null.
   *
   * @param event هوية الحدث
   * @returns أسماء المنفذين بالترتيب
   */
  performers(event: LowRatingEvent): Promise<readonly PerformerNames[]>;
  /**
   * يختار فائزًا واحدًا لكل تقييم، بما فيه قرار صفر مستلمين.
   *
   * @param event هوية الحدث
   * @param decision قرار الإشعار
   * @param decision.id معرّف صف الدفتر
   * @param decision.decidedAt لحظة القرار
   * @param decision.recipientCount المرشحون بلا تكرار
   * @returns هل فاز هذا الإدخال
   */
  claim(
    event: LowRatingEvent,
    decision: { id: string; decidedAt: Date; recipientCount: number },
  ): Promise<boolean>;
}

/** حمولة `LowRatingReceived`: مجموعة مستلمين بقالب واحد وبنفس النطاق. */
export interface LowRatingRequest {
  readonly business_id: string;
  readonly branch_id: string;
  readonly notification_recipients: readonly LowRatingRecipient[];
}

/** الأثر المتبادل مع الإشعارات يمر عبر الأوتبوكس فقط. */
export interface LowRatingOutbox {
  /**
   * يكتب مجموعة مستلمين ضمن معاملة الدفتر نفسها.
   *
   * @param id معرّف حدث المجموعة
   * @param ratingId التقييم صاحب الحدث (aggregate)
   * @param payload المجموعة بعد تحقق العقد
   * @returns اكتمال الكتابة دون التزام مستقل
   */
  append(id: string, ratingId: string, payload: LowRatingRequest): Promise<void>;
}

/** منافذ مثبتة على معاملة withTenant التي فتحها التوصيل. */
export interface LowRatingPorts {
  readonly rules: AlertRulePort;
  readonly recipients: LowRatingRecipients;
  readonly place: LowRatingPlace;
  readonly repository: LowRatingRepository;
  readonly outbox: LowRatingOutbox;
}
