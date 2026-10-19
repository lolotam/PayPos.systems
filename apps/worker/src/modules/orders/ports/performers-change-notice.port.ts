import type {
  PerformersChangeHistory,
  PerformersChangeParameters,
} from '../domain/performers-change-notice.ts';
import type { Clock, IdGenerator } from './late-service-session-notice.port.ts';

export type { Clock, IdGenerator };

/** هوية السطر من الحدث. تاريخ العمل جزء من المطابقة حتى لا يُحجز الدفتر بتاريخ زيارة أخرى، والمراجعة قد ترتفع بعد الحدث. */
export interface PerformersChangeNoticeLine {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly sessionId: string;
  readonly lineId: string;
  readonly revision: number;
  readonly businessDate: string;
}
/** اسم الخدمة من السطر والمنطقة المحفوظة على الزيارة، لا من الفرع الحالي. */
export interface PerformersChangeLineContext {
  readonly nameAr: string | null;
  readonly nameEn: string;
  readonly businessTimezone: string;
}
/** واجهة الهوية الخاصة بالأوامر؛ لا ترى الوحدة جداول العضويات. */
export interface PerformersChangeNoticeRecipients {
  /** يثبت أن الشركة مفتوحة قبل أخذ لقطة المديرين.
   *
   * @param companyId الشركة من الغلاف الموثوق
   * @returns هل الشركة مفتوحة
   */
  companyOpen(companyId: string): Promise<boolean>;
  /** يرجع مديري النطاق النشطين في لحظة القرار، بلا استثناء من غيّر المنفّذين.
   *
   * @param line نطاق السطر
   * @param at لحظة أخذ القرار
   * @param roles أدوار النظام المعتمدة
   * @returns معرفات المستخدمين المؤهلين
   */
  branchManagerRecipients(
    line: PerformersChangeNoticeLine,
    at: Date,
    roles: readonly string[],
  ): Promise<readonly string[]>;
}
/** قراءة أسماء الفرع فقط؛ تاريخ الإشعار ومنطقته من الزيارة. */
export interface PerformersChangeNoticePlace {
  /** يرجع اسمي الفرع أو null حتى لا يخمن المستهلك مكان الزيارة.
   *
   * @param line نطاق السطر
   * @returns أسماء الفرع إن وجد
   */
  branchPlace(
    line: PerformersChangeNoticeLine,
  ): Promise<{ nameAr: string | null; nameEn: string } | null>;
}
/** دفتر الجرس وقراءة تاريخ المنفّذين مقيدان بمعاملة المستهلك. */
export interface PerformersChangeNoticeRepository {
  /** يثبت وجود السطر في الشركة والنشاط والزيارة والفرع وأن تاريخ عمله يساوي الحدث ومراجعته لا تقل عن مراجعة الحدث.
   *
   * @param line هوية السطر من الحدث، ومنها تاريخ العمل
   * @returns هل يطابق المصدر داخل المستأجر
   */
  matchesLine(line: PerformersChangeNoticeLine): Promise<boolean>;
  /** يقرأ رأس التغيير عند مراجعة الحدث وصفّي قبل وبعد بالترتيب، بلا سبب ولا هوية من غيّر.
   *
   * @param companyId الشركة
   * @param lineId السطر
   * @param revision مراجعة الحدث
   * @returns الرأس والصفوف أو null إذا غاب الرأس
   */
  readPerformerChange(
    companyId: string,
    lineId: string,
    revision: number,
  ): Promise<PerformersChangeHistory | null>;
  /** يقرأ اسم الخدمة والمنطقة المحفوظة لأن الحدث لا يحمل المنطقة.
   *
   * @param line هوية السطر
   * @returns السياق أو null إذا غاب السطر
   */
  readLineContext(line: PerformersChangeNoticeLine): Promise<PerformersChangeLineContext | null>;
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
    line: PerformersChangeNoticeLine,
    decision: { id: string; sourceEventId: string; decidedAt: Date; recipientCount: number },
  ): Promise<boolean>;
}
/** عقد الحدث الخارج لا يحمل سبب التغيير ولا اسم منفّذ ولا هوية من غيّر ولا هاتف العميل. */
export interface PerformersChangeNoticeRequest {
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
    template_key: 'service_line_performers_changed';
    template_revision: 1;
    safe_parameters: PerformersChangeParameters;
  }[];
}
/** الأثر نحو الإشعارات يمر عبر الأوتبوكس فقط. */
export interface PerformersChangeNoticeOutbox {
  /** يكتب مجموعة المستلمين ضمن نفس معاملة الدفتر وعلامة الاستهلاك.
   *
   * @param id معرف حدث المجموعة
   * @param payload المجموعة والمعاملات الآمنة
   * @returns اكتمال الكتابة دون التزام مستقل
   */
  append(id: string, payload: PerformersChangeNoticeRequest): Promise<void>;
}
/** منافذ مثبتة على معاملة withTenant التي فتحها التوصيل. */
export interface PerformersChangeNoticePorts {
  readonly recipients: PerformersChangeNoticeRecipients;
  readonly place: PerformersChangeNoticePlace;
  readonly repository: PerformersChangeNoticeRepository;
  readonly outbox: PerformersChangeNoticeOutbox;
}
