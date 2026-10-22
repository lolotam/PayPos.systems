import type { LateNoticeParameters } from '../domain/late-service-session-notice.ts';
import type { AlertRulesPort } from './alert-rule.port.ts';

/** هوية الزيارة من الحدث، تؤكدها قراءة أوامر ضمن المستأجر نفسه. */
export interface LateNoticeSession {
  readonly companyId: string;
  readonly sessionId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly businessDate: string;
  readonly businessTimezone: string;
}
/** واجهة الهوية الخاصة بالأوامر؛ لا ترى الوحدة جداول العضويات. */
export interface LateNoticeRecipients {
  /** يثبت أهلية الشركة قبل أخذ لقطة المديرين.
   *
   * @param companyId الشركة من الغلاف الموثوق
   * @returns هل الشركة مفتوحة
   */
  companyOpen(companyId: string): Promise<boolean>;
  /** يرجع مديري النطاق النشطين دون استثناء المسجل أو المنفذ.
   *
   * @param session نطاق الزيارة المحفوظ
   * @param at لحظة أخذ القرار
   * @param roles أدوار النظام المعتمدة
   * @returns معرفات المستخدمين المؤهلين
   */
  forBranch(
    session: LateNoticeSession,
    at: Date,
    roles: readonly string[],
  ): Promise<readonly string[]>;
}
/** قراءة أسماء فقط؛ تاريخ الإشعار ومنطقته من الزيارة لا من الفرع الحالي. */
export interface LateNoticePlace {
  /** يرجع اسمي الفرع أو null حتى لا يخمن المستهلك مكان الزيارة.
   *
   * @param session نطاق الزيارة
   * @returns أسماء الفرع إن وجد
   */
  forBranch(session: LateNoticeSession): Promise<{ nameAr: string | null; nameEn: string } | null>;
}
/** دفتر دائم وأوتبوكس مقيدان بمعاملة المستهلك. */
export interface LateNoticeRepository {
  /** يثبت تطابق زيارة المستأجر والنشاط والفرع والتاريخ مع الحدث الموثوق.
   *
   * @param session هوية الزيارة المحفوظة
   * @returns هل تطابق المصدر داخل المستأجر
   */
  matchesSession(session: LateNoticeSession): Promise<boolean>;
  /** يختار فائزا واحدا لكل زيارة، بما في ذلك قرار صفر مستلمين.
   *
   * @param session هوية الزيارة
   * @param decision قرار الإشعار
   * @param decision.id معرف صف الدفتر
   * @param decision.sourceEventId الحدث الذي سبّب القرار
   * @param decision.decidedAt لحظة القرار
   * @param decision.recipientCount عدد المستخدمين بلا تكرار
   * @returns هل فاز هذا الإدخال
   */
  claim(
    session: LateNoticeSession,
    decision: { id: string; sourceEventId: string; decidedAt: Date; recipientCount: number },
  ): Promise<boolean>;
}
/** عقد الحدث الخارج لا يحمل أسماء العملاء أو المال. */
export interface LateNoticeRequest {
  readonly schema_version: 1;
  readonly session_id: string;
  readonly business_id: string;
  readonly branch_id: string;
  readonly business_date: string;
  readonly business_timezone: string;
  readonly notification_recipients: readonly {
    channel: 'IN_APP';
    user_id: string;
    locale: 'ar';
    template_key: 'late_service_session';
    template_revision: 1;
    safe_parameters: LateNoticeParameters;
  }[];
}
/** الأثر المتبادل مع الإشعارات يمر عبر الأوتبوكس فقط. */
export interface LateNoticeOutbox {
  /** يكتب مجموعة المستلمين ضمن نفس معاملة الدفتر وعلامة الاستهلاك.
   *
   * @param id معرف حدث المجموعة
   * @param payload المجموعة والمعاملات الآمنة
   * @returns اكتمال الكتابة دون التزام مستقل
   */
  append(id: string, payload: LateNoticeRequest): Promise<void>;
}
/** الساعة محقونة لكي تستعمل العضويات لحظة المعالجة نفسها. */
export interface Clock {
  /** يرجع لحظة أخذ قرار الإشعار. */ now(): Date;
}
/** لا توليد عشوائي داخل حالة الاستخدام. */
export interface IdGenerator {
  /** يرجع UUID v7 للدفتر أو حدث المجموعة. */ newId(): string;
}
/** منافذ مثبتة على معاملة withTenant التي فتحها التوصيل. */
export interface LateNoticePorts {
  readonly recipients: LateNoticeRecipients;
  readonly place: LateNoticePlace;
  readonly repository: LateNoticeRepository;
  readonly outbox: LateNoticeOutbox;
  readonly rules: AlertRulesPort;
}
