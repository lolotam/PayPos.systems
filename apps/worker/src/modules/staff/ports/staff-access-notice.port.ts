import type { EditorLabelSnapshot } from '@pospay/i18n';

import type {
  StaffAccessNoticeKind,
  StaffAccessNoticeParameters,
} from '../domain/staff-access-notice.ts';

/** حدث وصول الدخول: نوعه ومكانه ومعرّفاته — بلا رقم سري ولا هاتف. */
export interface StaffAccessNoticeEvent {
  readonly kind: StaffAccessNoticeKind;
  readonly companyId: string;
  readonly sourceEventId: string;
  readonly employeeId: string;
  readonly userId: string;
  readonly branchId: string;
}

/** لقطتا اسم الموظفة: اسمها العربي والإنجليزي ونشاطها. */
export interface StaffAccessNoticeEmployee {
  readonly businessId: string;
  readonly nameAr: string | null;
  readonly nameEn: string;
}

/** الفاعل ولحظة فعله: مين منح الدخول أو مين أعاد ضبط الرقم السري. */
export interface StaffAccessNoticeActorRecord {
  readonly actorUserId: string;
  readonly occurredAt: Date;
}

/** مكان الفرع وقت الفعل: الاسمان والتوقيت الفعلي. */
export interface StaffAccessNoticePlace {
  readonly nameAr: string | null;
  readonly nameEn: string;
  readonly timeZone: string;
}

/** حمولة طلب الجرس: مجموعة مستلمين ومعاملاتها الآمنة، بلا رقم سري ولا هاتف. */
export interface StaffAccessNoticePayload {
  readonly schema_version: 1;
  readonly business_id: string;
  readonly branch_id: string;
  readonly employee_id: string;
  readonly notification_recipients: readonly {
    readonly channel: 'IN_APP';
    readonly user_id: string;
    readonly locale: 'ar';
    readonly template_key: StaffAccessNoticeKind;
    readonly template_revision: 1;
    readonly safe_parameters: StaffAccessNoticeParameters;
  }[];
}

/**
 * منافذ جرس وصول الدخول: القراءة والحجز والكتابة، كلها على معاملة المستهلك نفسها.
 * الوحدة ما بتقرش جداول موديول تاني مباشرة؛ محتاجة غيرها يقرأوا لهم.
 */
export interface StaffAccessNoticePorts {
  /** يثبت أن الشركة مفتوحة قبل أخذ لقطة المستلمين.
   *
   * @param companyId الشركة من الغلاف الموثوق
   * @returns هل الشركة مفتوحة
   */
  readonly companyOpen: (companyId: string) => Promise<boolean>;
  /** يرجع مالكي الشركة النشطين في اللحظة دي، لأن التنبيه لازم يوصل لصاحب القرار في الشركة كلها.
   *
   * @param companyId الشركة
   * @param at لحظة نافذة العضوية
   * @returns معرفات المستخدمين المالكين
   */
  readonly owners: (companyId: string, at: Date) => Promise<readonly string[]>;
  /** يقرأ اسم الفرع وتوقيته الفعلي وقت الفعل.
   *
   * @param companyId الشركة
   * @param businessId نشاط الموظفة
   * @param branchId فرع الفعل
   * @returns المكان أو null إن لم يعد الفرع موجودًا
   */
  readonly place: (
    companyId: string,
    businessId: string,
    branchId: string,
  ) => Promise<StaffAccessNoticePlace | null>;
  /** يقرأ اسم الموظفة ونشاطها، بلا هاتف ولا رقم سري.
   *
   * @param companyId الشركة
   * @param employeeId الموظفة
   * @returns لقطة الموظفة أو null إن لم تعد موجودة
   */
  readonly readEmployee: (
    companyId: string,
    employeeId: string,
  ) => Promise<StaffAccessNoticeEmployee | null>;
  /** يقرأ الفاعل ولحظة فعله من سجل حينما حصل.
   *
   * @param event حدث الوصول
   * @returns الفاعل ولحظة فعله أو null إن لم يوجد أثر
   */
  readonly readActorRecord: (
    event: StaffAccessNoticeEvent,
  ) => Promise<StaffAccessNoticeActorRecord | null>;
  /** يقرأ لقطة الفاعل: اسمه الموظفة المرتبط ودوره وقت الفعل.
   *
   * @param companyId الشركة
   * @param businessId نشاط الموظفة
   * @param actorUserId المستخدم الفاعل
   * @param at لحظة الفعل
   * @returns لقطة المحرر أو null إن لم يوجد اسم ولا دور
   */
  readonly readActorProfile: (
    companyId: string,
    businessId: string,
    actorUserId: string,
    at: Date,
  ) => Promise<EditorLabelSnapshot | null>;
  /** يحجز الحدث المصدر مرة واحدة، فالتسليم المكرر ما يكرّرش الجرس.
   *
   * @param sourceEventId الحدث الذي سبّب الجرس
   * @returns هل فاز هذا الإدخال
   */
  readonly claim: (sourceEventId: string) => Promise<boolean>;
  /** الأثر نحو الإشعارات يمر عبر الأوتبوكس فقط.
   *
   * @param outbox كاتب الأوتبوكس على معاملة الدفتر
   */
  readonly outbox: {
    /** يكتب مجموعة المستلمين ضمن معاملة الدفتر وعلامة الاستهلاك نفسها.
     *
     * @param eventId معرف حدث المجموعة
     * @param employeeId الموظفة صاحبة الجرس
     * @param kind نوع الجرس
     * @param payload المجموعة والمعاملات الآمنة
     * @returns اكتمال الكتابة دون التزام مستقل
     */
    append(
      eventId: string,
      employeeId: string,
      kind: StaffAccessNoticeKind,
      payload: StaffAccessNoticePayload,
    ): Promise<void>;
  };
}
