import type { PriceEditParameters } from '../domain/price-edit-notice.ts';
import type { AlertRulesPort } from './alert-rule.port.ts';
import type { Clock, IdGenerator } from './late-service-session-notice.port.ts';

export type { Clock, IdGenerator };

/** هوية السطر من الحدث، تؤكدها قراءة أوامر داخل المستأجر نفسه. */
export interface PriceEditNoticeLine {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly sessionId: string;
  readonly lineId: string;
  readonly revision: number;
}
/** لقطة صف service_line_edits التي يُبنى منها اسم المحرر والمبالغ. */
export interface PriceEditSnapshot {
  readonly editorNameAr: string | null;
  readonly editorNameEn: string | null;
  readonly editorRole: string | null;
  readonly editorRoleIsSystem: boolean | null;
  readonly editorRoleNameAr: string | null;
  readonly editorRoleNameEn: string | null;
  readonly previousNet: string;
  readonly newNet: string;
}
/** اسم الخدمة من السطر والمنطقة المحفوظة على الزيارة، لا من الفرع الحالي. */
export interface PriceEditLineContext {
  readonly nameAr: string | null;
  readonly nameEn: string;
  readonly businessTimezone: string;
}
/** واجهة الهوية الخاصة بالأوامر؛ لا ترى الوحدة جداول العضويات. */
export interface PriceEditNoticeRecipients {
  /** يثبت أن الشركة مفتوحة قبل أخذ لقطة المديرين.
   *
   * @param companyId الشركة من الغلاف الموثوق
   * @returns هل الشركة مفتوحة
   */
  companyOpen(companyId: string): Promise<boolean>;
  /** يرجع مديري النطاق النشطين في لحظة القرار، بلا استثناء المحرر.
   *
   * @param line نطاق السطر
   * @param at لحظة أخذ القرار
   * @param roles أدوار النظام المعتمدة
   * @returns معرفات المستخدمين المؤهلين
   */
  branchManagerRecipients(
    line: PriceEditNoticeLine,
    at: Date,
    roles: readonly string[],
  ): Promise<readonly string[]>;
}
/** قراءة أسماء الفرع فقط؛ تاريخ الإشعار ومنطقته من الزيارة. */
export interface PriceEditNoticePlace {
  /** يرجع اسمي الفرع أو null حتى لا يخمن المستهلك مكان الزيارة.
   *
   * @param line نطاق السطر
   * @returns أسماء الفرع إن وجد
   */
  branchPlace(line: PriceEditNoticeLine): Promise<{ nameAr: string | null; nameEn: string } | null>;
}
/** دفتر التعديل وقراءة التاريخ مقيدان بمعاملة المستهلك. */
export interface PriceEditNoticeRepository {
  /** يثبت وجود السطر في الشركة والنشاط والفرع والزيارة وأن مراجعته الحالية تغطي الحدث.
   *
   * @param line هوية السطر من الحدث
   * @returns هل يطابق المصدر داخل المستأجر
   */
  matchesLine(line: PriceEditNoticeLine): Promise<boolean>;
  /** يقرأ لقطة (line, revision) لأن اسم المحرر يُحفظ وقت التعديل لا وقت الجرس.
   *
   * @param companyId الشركة
   * @param lineId السطر
   * @param revision مراجعة الحدث
   * @returns اللقطة أو null إذا غاب صف التاريخ
   */
  readEditSnapshot(
    companyId: string,
    lineId: string,
    revision: number,
  ): Promise<PriceEditSnapshot | null>;
  /** يقرأ اسم الخدمة والمنطقة المحفوظة لأن الحدث لا يحمل المنطقة.
   *
   * @param line هوية السطر
   * @returns السياق أو null إذا غاب السطر
   */
  readLineContext(line: PriceEditNoticeLine): Promise<PriceEditLineContext | null>;
  /** يحجز فائزا واحدا لكل (سطر، مراجعة)، بما في ذلك قرار صفر مستلمين.
   *
   * @param line هوية السطر
   * @param decision قرار الإشعار
   * @param decision.id معرف صف الدفتر
   * @param decision.sourceEventId الحدث الذي سبّب القرار
   * @param decision.decidedAt لحظة القرار
   * @param decision.recipientCount عدد المستخدمين بلا تكرار
   * @returns هل فاز هذا الإدخال
   */
  claim(
    line: PriceEditNoticeLine,
    decision: { id: string; sourceEventId: string; decidedAt: Date; recipientCount: number },
  ): Promise<boolean>;
}
/** عقد الحدث الخارج لا يحمل سبب التعديل ولا هاتف العميل. */
export interface PriceEditNoticeRequest {
  readonly schema_version: 1;
  readonly session_id: string;
  readonly line_id: string;
  readonly revision: number;
  readonly business_id: string;
  readonly branch_id: string;
  readonly business_date: string;
  readonly business_timezone: string;
  readonly notification_recipients: readonly {
    channel: 'IN_APP';
    user_id: string;
    locale: 'ar';
    template_key: 'service_line_price_edited';
    template_revision: 1;
    safe_parameters: PriceEditParameters;
  }[];
}
/** الأثر نحو الإشعارات يمر عبر الأوتبوكس فقط. */
export interface PriceEditNoticeOutbox {
  /** يكتب مجموعة المستلمين ضمن نفس معاملة الدفتر وعلامة الاستهلاك.
   *
   * @param id معرف حدث المجموعة
   * @param payload المجموعة والمعاملات الآمنة
   * @returns اكتمال الكتابة دون التزام مستقل
   */
  append(id: string, payload: PriceEditNoticeRequest): Promise<void>;
}
/** منافذ مثبتة على معاملة withTenant التي فتحها التوصيل. */
export interface PriceEditNoticePorts {
  readonly recipients: PriceEditNoticeRecipients;
  readonly place: PriceEditNoticePlace;
  readonly repository: PriceEditNoticeRepository;
  readonly outbox: PriceEditNoticeOutbox;
  readonly rules: AlertRulesPort;
}
