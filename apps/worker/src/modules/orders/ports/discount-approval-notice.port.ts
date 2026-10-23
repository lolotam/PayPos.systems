import type { DiscountApprovalNoticeParameters } from '../domain/discount-approval-notice.ts';

/** خدمة واحدة كما أعلنها الحدث: لقطة الاسم وقت الطلب، فلا يقرأ الجرس الكتالوج. */
export interface DiscountApprovalNoticeService {
  readonly serviceId: string;
  readonly nameAr: string | null;
  readonly nameEn: string;
}

/** هوية طلب الموافقة وبياناته كما أعلنها الحدث؛ لا اسم عميل ولا هاتف ولا شروط خصم. */
export interface DiscountApprovalNoticeRequest {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly requestId: string;
  readonly requestedBy: string;
  readonly lineCount: number;
  readonly maxEffectiveBps: number;
  readonly services: readonly DiscountApprovalNoticeService[];
}

/** واجهة الهوية الخاصة بالأوامر؛ لا ترى الوحدة جداول العضويات. */
export interface DiscountApprovalNoticeRecipients {
  /** يثبت أن الشركة مفتوحة قبل أخذ لقطة الموافقين.
   *
   * @param companyId الشركة من الغلاف الموثوق
   * @returns هل الشركة مفتوحة
   */
  companyOpen(companyId: string): Promise<boolean>;
  /** يرجع كل من يملك approve:discounts:branch فعلياً على الفرع في اللحظة المحقونة، بلا استثناء الطالبة.
   *
   * @param request هوية الطلب وبياناته
   * @param at لحظة أخذ القرار
   * @returns معرفات المستخدمين المؤهلين
   */
  discountApproverRecipients(
    request: DiscountApprovalNoticeRequest,
    at: Date,
  ): Promise<readonly string[]>;
}

/** قراءة أسماء الفرع فقط؛ اسم الخدمة من الحدث. */
export interface DiscountApprovalNoticePlace {
  /** يرجع اسمي الفرع أو null حتى لا يخمن المستهلك مكان الطلب.
   *
   * @param request هوية الطلب
   * @returns أسماء الفرع إن وُجد
   */
  branchPlace(
    request: DiscountApprovalNoticeRequest,
  ): Promise<{ nameAr: string | null; nameEn: string } | null>;
}

/** دفتر الجرس مقيد بمعاملة المستهلك. */
export interface DiscountApprovalNoticeRepository {
  /** يثبت أن اقتراحات الطلب المخزنة تطابق الحدث عدداً وأعلى نسبة، فالحدث الفاسد لا يُحجز له صف.
   *
   * @param request هوية الطلب وبياناته
   * @returns هل يطابق المصدر داخل المستأجر
   */
  matchesRequest(request: DiscountApprovalNoticeRequest): Promise<boolean>;
  /** يحجز فائزا واحدا لكل طلب، بما في ذلك قرار صفر مستلمين.
   *
   * @param request هوية الطلب
   * @param decision قرار الإشعار
   * @param decision.id معرف صف الدفتر
   * @param decision.sourceEventId الحدث الذي سبّب القرار
   * @param decision.decidedAt لحظة القرار
   * @param decision.recipientCount عدد المستخدمين بلا تكرار
   * @returns هل فاز هذا الإدخال
   */
  claim(
    request: DiscountApprovalNoticeRequest,
    decision: { id: string; sourceEventId: string; decidedAt: Date; recipientCount: number },
  ): Promise<boolean>;
}

/** عقد الحدث الخارج لا يحمل اسم عميل ولا هاتف ولا الطالبة ولا شروط الخصم. */
export interface DiscountApprovalNoticeRequestPayload {
  readonly schema_version: 1;
  readonly request_id: string;
  readonly business_id: string;
  readonly branch_id: string;
  readonly notification_recipients: readonly {
    channel: 'IN_APP';
    user_id: string;
    locale: 'ar';
    template_key: 'discount_approval_requested';
    template_revision: 1;
    safe_parameters: DiscountApprovalNoticeParameters;
  }[];
}

/** الأثر نحو الإشعارات يمر عبر الأوتبوكس فقط. */
export interface DiscountApprovalNoticeOutbox {
  /** يكتب مجموعة المستلمين ضمن نفس معاملة الدفتر وعلامة الاستهلاك.
   *
   * @param id معرف حدث المجموعة
   * @param payload المجموعة والمعاملات الآمنة
   * @returns اكتمال الكتابة دون التزام مستقل
   */
  append(id: string, payload: DiscountApprovalNoticeRequestPayload): Promise<void>;
}

/** منافذ مثبتة على معاملة withTenant التي فتحها التوصيل. */
export interface DiscountApprovalNoticePorts {
  readonly recipients: DiscountApprovalNoticeRecipients;
  readonly place: DiscountApprovalNoticePlace;
  readonly repository: DiscountApprovalNoticeRepository;
  readonly outbox: DiscountApprovalNoticeOutbox;
}
