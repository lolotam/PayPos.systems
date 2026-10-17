import type { LineCancelParameters } from '../domain/line-cancel-notice.ts';
import type { Clock, IdGenerator } from './late-service-session-notice.port.ts';

export type { Clock, IdGenerator };

/** هوية السطر من الحدث، تؤكدها قراءة أوامر داخل المستأجر نفسه. تاريخ العمل جزء من المطابقة حتى لا يُحجز الدفتر بتاريخ زيارة أخرى. */
export interface LineCancelNoticeLine {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly sessionId: string;
  readonly lineId: string;
  readonly revision: number;
  readonly businessDate: string;
}
/** صف service_line_cancellations الذي يُطابق مراجعة الحدث وصافي السطر. */
export interface LineCancelHistory {
  readonly revision: number;
  readonly previousNet: string;
}
/** اسم الخدمة من السطر والمنطقة المحفوظة على الزيارة، لا من الفرع الحالي. */
export interface LineCancelLineContext {
  readonly nameAr: string | null;
  readonly nameEn: string;
  readonly businessTimezone: string;
}
/** واجهة الهوية الخاصة بالأوامر؛ لا ترى الوحدة جداول العضويات. */
export interface LineCancelNoticeRecipients {
  /** يثبت أن الشركة مفتوحة قبل أخذ لقطة المديرين.
   *
   * @param companyId الشركة من الغلاف الموثوق
   * @returns هل الشركة مفتوحة
   */
  companyOpen(companyId: string): Promise<boolean>;
  /** يرجع مديري النطاق النشطين في لحظة القرار، بلا استثناء المُلغي.
   *
   * @param line نطاق السطر
   * @param at لحظة أخذ القرار
   * @param roles أدوار النظام المعتمدة
   * @returns معرفات المستخدمين المؤهلين
   */
  branchManagerRecipients(
    line: LineCancelNoticeLine,
    at: Date,
    roles: readonly string[],
  ): Promise<readonly string[]>;
}
/** قراءة أسماء الفرع فقط؛ تاريخ الإشعار ومنطقته من الزيارة. */
export interface LineCancelNoticePlace {
  /** يرجع اسمي الفرع أو null حتى لا يخمن المستهلك مكان الزيارة.
   *
   * @param line نطاق السطر
   * @returns أسماء الفرع إن وجد
   */
  branchPlace(
    line: LineCancelNoticeLine,
  ): Promise<{ nameAr: string | null; nameEn: string } | null>;
}
/** دفتر الإلغاء وقراءة التاريخ مقيدان بمعاملة المستهلك. */
export interface LineCancelNoticeRepository {
  /** يثبت وجود السطر الملغي في الشركة والنشاط والفرع والزيارة، وأن مراجعته وتاريخ عمله يساويان الحدث.
   *
   * @param line هوية السطر من الحدث، ومنها تاريخ العمل
   * @returns هل يطابق المصدر داخل المستأجر
   */
  matchesLine(line: LineCancelNoticeLine): Promise<boolean>;
  /** يقرأ مراجعة الإلغاء وصافي السطر لأن الجرس يُقرع فقط إذا طابقا الحدث.
   *
   * @param companyId الشركة
   * @param lineId السطر
   * @returns المراجعة والصافي أو null إذا غاب صف التاريخ
   */
  readCancellation(companyId: string, lineId: string): Promise<LineCancelHistory | null>;
  /** يقرأ اسم الخدمة والمنطقة المحفوظة لأن الحدث لا يحمل المنطقة.
   *
   * @param line هوية السطر
   * @returns السياق أو null إذا غاب السطر
   */
  readLineContext(line: LineCancelNoticeLine): Promise<LineCancelLineContext | null>;
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
    line: LineCancelNoticeLine,
    decision: { id: string; sourceEventId: string; decidedAt: Date; recipientCount: number },
  ): Promise<boolean>;
}
/** عقد الحدث الخارج لا يحمل سبب الإلغاء ولا هوية المُلغي ولا هاتف العميل. */
export interface LineCancelNoticeRequest {
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
    template_key: 'service_line_cancelled';
    template_revision: 1;
    safe_parameters: LineCancelParameters;
  }[];
}
/** الأثر نحو الإشعارات يمر عبر الأوتبوكس فقط. */
export interface LineCancelNoticeOutbox {
  /** يكتب مجموعة المستلمين ضمن نفس معاملة الدفتر وعلامة الاستهلاك.
   *
   * @param id معرف حدث المجموعة
   * @param payload المجموعة والمعاملات الآمنة
   * @returns اكتمال الكتابة دون التزام مستقل
   */
  append(id: string, payload: LineCancelNoticeRequest): Promise<void>;
}
/** منافذ مثبتة على معاملة withTenant التي فتحها التوصيل. */
export interface LineCancelNoticePorts {
  readonly recipients: LineCancelNoticeRecipients;
  readonly place: LineCancelNoticePlace;
  readonly repository: LineCancelNoticeRepository;
  readonly outbox: LineCancelNoticeOutbox;
}
