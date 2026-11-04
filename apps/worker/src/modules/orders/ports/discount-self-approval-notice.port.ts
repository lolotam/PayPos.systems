import type { DiscountSelfApprovalNoticeParameters } from '../domain/discount-self-approval-notice.ts';
import type { AlertRulesPort } from './alert-rule.port.ts';

/** مقترح موسوم في الحدث: لقطة الخدمة وقت الطلب، فلا يقرأ الجرس الكتالوج ولا بيانات العملاء. */
export interface DiscountSelfApprovalNoticeProposal {
  readonly id: string;
  readonly serviceId: string;
  readonly nameAr: string | null;
  readonly nameEn: string;
  readonly effectiveBps: number;
}

/** هوية قرار الموافقة الذاتية كما أعلنها الحدث المُتحقق؛ لا اسم عميل ولا هاتف ولا إعادة تقييم للمنفّذ الحالي. */
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

/** واجهة الهوية الخاصة بالأوامر؛ لا ترى الوحدة جداول العضويات، والموافِق غير مستبعد (DA-Q10). */
export interface DiscountSelfApprovalNoticeRecipients {
  /** يثبت أن الشركة مفتوحة قبل أخذ لقطة المستلمين.
   *
   * @param companyId الشركة من الغلاف الموثوق
   * @returns هل الشركة مفتوحة
   */
  companyOpen(companyId: string): Promise<boolean>;
  /** يرجع مستخدمي العضويات النشطة التي تغطي الفرع بدور نظام من أدوار القاعدة الفعلية، بلا استثناء الموافِق.
   *
   * @param event نطاق القرار داخل المستأجر
   * @param at لحظة أخذ القرار
   * @param roles أكواد أدوار القاعدة الفعلية؛ فارغة تعني لا أحد
   * @returns معرفات المستخدمين المؤهلين
   */
  roleRecipients(
    event: DiscountSelfApprovalNoticeEvent,
    at: Date,
    roles: readonly string[],
  ): Promise<readonly string[]>;
}

/** قراءة أسماء الفرع فقط؛ اسم الخدمة ولقطة تسمية الموافِق من الحدث. */
export interface DiscountSelfApprovalNoticePlace {
  /** يرجع اسمي الفرع أو null حتى لا يخمن المستهلك مكان القرار.
   *
   * @param event نطاق القرار داخل المستأجر
   * @returns أسماء الفرع إن وُجد
   */
  branchPlace(
    event: DiscountSelfApprovalNoticeEvent,
  ): Promise<{ nameAr: string | null; nameEn: string } | null>;
}

/** دفتر الجرس مقيد بمعاملة المستهلك. */
export interface DiscountSelfApprovalNoticeRepository {
  /** يثبت أن كل مقترح موسوم مخزون في هذا النشاط والفرع بذات الحقائق المحفوظة وقت القرار —
   * service_id وeffective_bps وdecided_by وdecided_via وapprover_is_performer، بالعدد exact —
   * وحالته APPROVED أو CONSUMED، فلا يُحجز صف لحدث فاسد ولا يتسمم بإعادة بعد استهلاك شرعي.
   *
   * @param event القرار كما أعلنه الحدث المُتحقق
   * @returns هل يطابق المصدر داخل المستأجر
   */
  matchesProposals(event: DiscountSelfApprovalNoticeEvent): Promise<boolean>;
  /** يحجز فائزا واحدا لكل حدث مصدر، بما في ذلك قرار صفر مستلمين.
   *
   * @param event القرار كما أعلنه الحدث
   * @param decision قرار الإشعار
   * @param decision.id معرف صف الدفتر
   * @param decision.sourceEventId حدث الأوتبوكس الذي سبّب القرار
   * @param decision.decidedAt لحظة القرار
   * @param decision.recipientCount عدد المستخدمين بلا تكرار
   * @returns هل فاز هذا الإدخال
   */
  claim(
    event: DiscountSelfApprovalNoticeEvent,
    decision: { id: string; sourceEventId: string; decidedAt: Date; recipientCount: number },
  ): Promise<boolean>;
}

/** عقد الحدث الخارج لا يحمل اسم عميل ولا هاتف ولا شروط الخصم؛ proposal_ids هي المقترحات الموسومة كلها. */
export interface DiscountSelfApprovalNoticePayload {
  readonly schema_version: 1;
  readonly business_id: string;
  readonly branch_id: string;
  readonly proposal_ids: readonly string[];
  readonly notification_recipients: readonly {
    channel: 'IN_APP';
    user_id: string;
    locale: 'ar';
    template_key: 'discount_self_approved';
    template_revision: 1;
    safe_parameters: DiscountSelfApprovalNoticeParameters;
  }[];
}

/** الأثر نحو الإشعارات يمر عبر الأوتبوكس فقط؛ aggregate ضيق يقترن بصف الدفتر الفائز. */
export interface DiscountSelfApprovalNoticeOutbox {
  /** يكتب مجموعة المستلمين ضمن نفس معاملة الدفتر وعلامة الاستهلاك.
   *
   * @param id معرف حدث المجموعة
   * @param aggregateId معرف صف الدفتر الفائز
   * @param payload المجموعة والمعاملات الآمنة
   * @returns اكتمال الكتابة دون التزام مستقل
   */
  append(
    id: string,
    aggregateId: string,
    payload: DiscountSelfApprovalNoticePayload,
  ): Promise<void>;
}

/** منافذ مثبتة على معاملة withTenant التي فتحها التوصيل. */
export interface DiscountSelfApprovalNoticePorts {
  readonly recipients: DiscountSelfApprovalNoticeRecipients;
  readonly place: DiscountSelfApprovalNoticePlace;
  readonly repository: DiscountSelfApprovalNoticeRepository;
  readonly outbox: DiscountSelfApprovalNoticeOutbox;
  readonly rules: AlertRulesPort;
}
