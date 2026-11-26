import type { PackageRefundParameters } from '../domain/package-refund-notice.ts';
import type { Clock, IdGenerator } from './late-service-session-notice.port.ts';

export type { Clock, IdGenerator };

/** هوية الاسترداد من الحدث؛ سطر الاسترداد داخل المستأجر هو اللي يؤكدها. */
export interface PackageRefundNoticeRefund {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly entitlementId: string;
  readonly componentId: string;
  readonly refundId: string;
  readonly sessions: number;
  readonly amount: string;
  readonly businessDate: string;
  readonly refundedAt: string;
  readonly entitlementRevision: number;
}

/** أسماء الباقة والمنطقة الزمنية من الاستحقاق المحروس؛ ما فيش سبب ولا اسم عميل. */
export interface PackageRefundNoticeContext {
  readonly packageNameAr: string | null;
  readonly packageNameEn: string;
  readonly businessTimezone: string;
}

/** واجهة الهوية الخاصة بالأوامر؛ لا ترى الوحدة جداول العضويات. */
export interface PackageRefundNoticeRecipients {
  /**
   * يثبت أن الشركة مفتوحة قبل أخذ لقطة المديرين.
   *
   * @param companyId الشركة من الغلاف الموثوق
   * @returns هل الشركة مفتوحة
   */
  companyOpen(companyId: string): Promise<boolean>;
  /**
   * يرجع مديري النطاق النشطين في لحظة القرار؛ المسترد نفسه مش مستثنى (FR-056).
   *
   * @param refund نطاق الاسترداد
   * @param at لحظة أخذ القرار
   * @param roles أدوار النظام المعتمدة
   * @returns معرفات المستخدمين المؤهلين
   */
  branchManagerRecipients(
    refund: PackageRefundNoticeRefund,
    at: Date,
    roles: readonly string[],
  ): Promise<readonly string[]>;
}

/** قراءة أسماء الفرع فقط؛ تاريخ الإشعار ومنطقته من سطر الاسترداد نفسه. */
export interface PackageRefundNoticePlace {
  /**
   * يرجع اسمي الفرع أو null حتى لا يخمن المستهلك مكان الاسترداد.
   *
   * @param refund نطاق الاسترداد
   * @returns أسماء الفرع إن وجد
   */
  branchPlace(
    refund: PackageRefundNoticeRefund,
  ): Promise<{ nameAr: string | null; nameEn: string } | null>;
}

/** دفتر الجرس وقراءة سطر الاسترداد مقيدان بمعاملة المستهلك. */
export interface PackageRefundNoticeRepository {
  /**
   * يثبت وجود سطر الاسترداد في الشركة والنشاط والفرع والاستحقاق، وأن جلساته ومبلغه وتاريخه يطابقون الحدث.
   *
   * @param refund هوية الاسترداد من الحدث
   * @returns هل يطابق المصدر داخل المستأجر
   */
  matchesRefund(refund: PackageRefundNoticeRefund): Promise<boolean>;
  /**
   * يقرأ اسم الباقة والمنطقة الزمنية لأن الحدث لا يحملهما؛ ما فيش سبب ولا اسم عميل في القراءة.
   *
   * @param refund هوية الاسترداد
   * @returns السياق أو null إذا غاب الاستحقاق
   */
  readRefundContext(refund: PackageRefundNoticeRefund): Promise<PackageRefundNoticeContext | null>;
  /**
   * يحجز صفًا واحدًا لكل استرداد، بما في ذلك قرار صفر مستلمين.
   *
   * @param refund هوية الاسترداد
   * @param decision قرار الإشعار
   * @param decision.id معرف صف الدفتر
   * @param decision.sourceEventId الحدث الذي سبّب القرار
   * @param decision.decidedAt لحظة القرار
   * @param decision.recipientCount عدد المستخدمين بلا تكرار
   * @returns هل فاز هذا الإدخال
   */
  claim(
    refund: PackageRefundNoticeRefund,
    decision: { id: string; sourceEventId: string; decidedAt: Date; recipientCount: number },
  ): Promise<boolean>;
}

/** عقد الحدث الخارج لا يحمل سبب الاسترداد ولا اسم العميل ولا هاتفه ولا هوية المسترد. */
export interface PackageRefundNoticeRequest {
  readonly schema_version: 1;
  readonly refund_id: string;
  readonly entitlement_id: string;
  readonly business_id: string;
  readonly branch_id: string;
  readonly business_date: string;
  readonly business_timezone: string;
  readonly notification_recipients: readonly {
    channel: 'IN_APP';
    user_id: string;
    locale: 'ar';
    template_key: 'package_refund_recorded';
    template_revision: 1;
    safe_parameters: PackageRefundParameters;
  }[];
}

/** الأثر نحو الإشعارات يمر عبر الأوتبوكس فقط. */
export interface PackageRefundNoticeOutbox {
  /**
   * يكتب مجموعة المستلمين ضمن نفس معاملة الدفتر وعلامة الاستهلاك.
   *
   * @param id معرف حدث المجموعة
   * @param payload المجموعة والمعاملات الآمنة
   * @returns اكتمال الكتابة دون التزام مستقل
   */
  append(id: string, payload: PackageRefundNoticeRequest): Promise<void>;
}

/** منافذ مثبتة على معاملة withTenant التي فتحها التوصيل. */
export interface PackageRefundNoticePorts {
  readonly recipients: PackageRefundNoticeRecipients;
  readonly place: PackageRefundNoticePlace;
  readonly repository: PackageRefundNoticeRepository;
  readonly outbox: PackageRefundNoticeOutbox;
}
