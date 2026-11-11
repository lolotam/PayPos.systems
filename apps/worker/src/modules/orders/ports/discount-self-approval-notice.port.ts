import type { DiscountSelfApprovalNoticeParameters } from '../domain/discount-self-approval-notice.ts';
import type { AlertRulesPort } from './alert-rule.port.ts';
import type { DiscountApprovalNoticePlace } from './discount-approval-notice.port.ts';

/** اقتراح موسوم كما أعلنه الحدث: لقطة الخدمة والنسبة وقت القرار، فلا يقرأ الجرس الكتالوج. */
export interface DiscountSelfApprovalNoticeProposal {
  readonly id: string;
  readonly serviceId: string;
  readonly nameAr: string | null;
  readonly nameEn: string;
  readonly effectiveBps: number;
}

/** حدث الموافقة على عمل الموافِق: مكان القرار وتسميته المجمدة والاقتراحات الموسومة فقط. */
export interface DiscountSelfApprovalNoticeEvent {
  readonly companyId: string;
  readonly sourceEventId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly decidedBy: string;
  readonly deciderLabelAr: string;
  readonly deciderLabelEn: string;
  readonly decidedVia: 'PIN' | 'REMOTE';
  readonly proposals: readonly DiscountSelfApprovalNoticeProposal[];
}

/** واجهة المستلمين بالأدوار؛ لا ترى الوحدة جداول العضويات ولا تستبعد الموافِق. */
export interface DiscountSelfApprovalNoticeRecipients {
  /** يثبت أن الشركة مفتوحة قبل أخذ لقطة المستلمين.
   *
   * @param companyId الشركة من الغلاف الموثوق
   * @returns هل الشركة مفتوحة
   */
  companyOpen(companyId: string): Promise<boolean>;
  /** يرجع مستخدمي العضويات النشطة بالأدوار الفعلية التي تغطي الفرع، بلا استثناء الموافِق، والأدوار الفارغة تعني لا أحد.
   *
   * @param event حدث الموافقة ومكانها
   * @param at لحظة أخذ القرار
   * @param roles أدوار القاعدة الفعلية للتنبيه
   * @returns معرفات المستخدمين المؤهلين
   */
  roleRecipients(
    event: DiscountSelfApprovalNoticeEvent,
    at: Date,
    roles: readonly string[],
  ): Promise<readonly string[]>;
}

/** دفتر الجرس مقيد بمعاملة المستهلك، وإثبات المصدر يسبق أي حجز. */
export interface DiscountSelfApprovalNoticeRepository {
  /** يثبت أن كل معرف موسوم موجود داخل الشركة والنشاط والفرع بنفس service_id وeffective_bps وdecided_by وdecided_via وأن approver_is_performer true، بالعدد المضبوط وحالة APPROVED أو CONSUMED.
   *
   * @param event حدث الموافقة واقتراحاتها الموسومة
   * @returns هل تطابق كل الاقتراحات المخزنة الحدث تماماً
   */
  matchesProposals(event: DiscountSelfApprovalNoticeEvent): Promise<boolean>;
  /** يحجز فائزاً واحداً لكل حدث مصدر، بما في ذلك قرار صفر مستلمين.
   *
   * @param event حدث الموافقة ومصدره
   * @param decision قرار الإشعار
   * @param decision.id معرف صف الدفتر
   * @param decision.sourceEventId الحدث الذي سبّب القرار
   * @param decision.decidedAt لحظة القرار
   * @param decision.recipientCount عدد المستخدمين بلا تكرار
   * @returns هل فاز هذا الإدخال
   */
  claim(
    event: DiscountSelfApprovalNoticeEvent,
    decision: { id: string; sourceEventId: string; decidedAt: Date; recipientCount: number },
  ): Promise<boolean>;
}

/** عقد الحدث الخارج لا يحمل اسم عميل ولا هاتف ولا الطالبة؛ المصفوفات قابلة للتعديل كما في عقد Zod. */
export interface DiscountSelfApprovalNoticePayload {
  readonly schema_version: 1;
  readonly business_id: string;
  readonly branch_id: string;
  readonly proposal_ids: string[];
  readonly notification_recipients: {
    readonly channel: 'IN_APP';
    readonly user_id: string;
    readonly locale: 'ar';
    readonly template_key: 'discount_self_approved';
    readonly template_revision: 1;
    readonly safe_parameters: DiscountSelfApprovalNoticeParameters;
  }[];
}

/** الأثر نحو الإشعارات يمر عبر الأوتبوكس فقط. */
export interface DiscountSelfApprovalNoticeOutbox {
  /** يكتب مجموعة المستلمين ضمن معاملة الدفتر وعلامة الاستهلاك نفسها.
   *
   * @param id معرف حدث المجموعة
   * @param aggregateId معرف صف الدفتر الفائز
   * @param payload المجموعة والمعاملات الآمنة
   * @returns اكتمال الكتابة دون التزام مستقل
   */
  append(id: string, aggregateId: string, payload: DiscountSelfApprovalNoticePayload): Promise<void>;
}

/** منافذ مثبتة على معاملة withTenant التي فتحها التوصيل؛ قراءة المكان والقاعدة تستعادان بلا منفذ جديد. */
export interface DiscountSelfApprovalNoticePorts {
  readonly recipients: DiscountSelfApprovalNoticeRecipients;
  readonly place: DiscountApprovalNoticePlace;
  readonly repository: DiscountSelfApprovalNoticeRepository;
  readonly outbox: DiscountSelfApprovalNoticeOutbox;
  readonly rules: AlertRulesPort;
}
