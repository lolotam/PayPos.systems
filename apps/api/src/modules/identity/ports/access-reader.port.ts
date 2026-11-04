import type { AccessGrant, AccessTarget, ScopeType } from '../domain/access.ts';

/**
 * نطاق عضوية واحدة سارية للمستخدم في الشركة.
 */
export interface ActiveMembership {
  readonly scopeType: ScopeType;
  readonly scopeId: string;
}

/**
 * صلاحية ومعاها مصدرها — role العضوية ولا override — عشان الـ principal يوضّح جات منين.
 */
export interface SourcedGrant extends AccessGrant {
  readonly source: 'role' | 'override';
}

/** النطاق المؤكد وكل النطاقات التابعة المتأثرة؛ يحتاجها الـ guard لمنع كشف هدف ممنوع عن طريق فحص الجسم. */
export interface ResolvedAccessTargets {
  readonly target: AccessTarget;
  readonly descendantTargets: readonly AccessTarget[];
}

/** عضويات ومنح الشركة الحية؛ نفس الشكل لإعادة الفحص داخل معاملة الكتابة. */
export interface CompanyAccess {
  readonly memberships: readonly ActiveMembership[];
  readonly grants: readonly SourcedGrant[];
}

/** هدف مطبّع يثبت القارئ وجوده في الشركة قبل إرجاع المنح. */
export type AccessTargetRequest =
  | { readonly kind: 'company' }
  | { readonly kind: 'business'; readonly businessId: string }
  | { readonly kind: 'branch'; readonly branchId: string }
  | { readonly kind: 'membership'; readonly membershipId: string };

/** نتيجة ميزة مقروءة من الخادم وليست claim من العميل. */
export interface AccessFeature {
  readonly flag: string;
  readonly enabled: boolean;
}

/** بيانات التقييم داخل المعاملة؛ لا تخرج منها قدرة قراءة أو كائن Tx. */
export interface AccessInspection {
  readonly targets: ResolvedAccessTargets;
  readonly access: CompanyAccess;
}

/**
 * اللي الـ guard محتاج يقراه عشان يقرر — كل method بتقرا في الطلب نفسه، مفيش cache.
 */
export interface AccessReader {
  /**
   * يثبت الهدف والمنح ثم يستدعي قرار الإذن قبل قراءة الميزة في نفس المعاملة؛ المجهول أو المرفوض يرجع null.
   *
   * @param companyId الشركة المؤكدة
   * @param userId المستخدم الموثق
   * @param request الهدف المطبّع
   * @param options قرار الإذن الصافي والميزة المطلوبة؛ خطأ قراءة الميزة لا يسبق رفض الإذن
   * @param options.featureFlag اسم الميزة المطلوبة إن وجدت
   * @param options.allows قرار الإذن الصافي الذي يسبق أي قراءة للميزة
   */
  accessAt(
    companyId: string,
    userId: string,
    request: AccessTargetRequest,
    options: {
      readonly featureFlag?: string;
      readonly allows: (inspection: AccessInspection) => boolean;
    },
  ): Promise<(AccessInspection & { readonly feature?: AccessFeature }) | null>;
  /**
   * يثبت فروع الصفحة ويقرأ المنح مرة واحدة؛ غياب كل الفروع يرجع null.
   *
   * @param companyId الشركة المؤكدة
   * @param userId المستخدم الموثق
   * @param branchIds فروع الصفحة دون تكرار
   */
  accessAtBranches(
    companyId: string,
    userId: string,
    branchIds: readonly string[],
  ): Promise<{ businesses: ReadonlyMap<string, string>; access: CompanyAccess } | null>;
  /**
   * الشركات اللي المستخدم ليه فيها عضوية سارية دلوقتي — بتتقري تحت withUser قبل ما أي tenant يتفتح.
   *
   * @param userId المستخدم اللي الـ session اتأكدت له
   */
  companiesOf(userId: string): Promise<readonly string[]>;
  /**
   * هل الـ feature مفعّلة للشركة: override ساري لو موجود، وإلا flag الـ plan، وإلا مقفولة.
   * شركة اتعملها soft-delete أو صفها مش ظاهر بتبقى مقفولة حتى لو فيها override.
   *
   * @param companyId الشركة المتأكد منها
   * @param flag      اسم الـ feature flag
   */
  isFeatureEnabled(companyId: string, flag: string): Promise<boolean>;
}

/** قراءة إذن واحد لفروع كثيرة عبر نفس تفويض الطلب المفرد؛ يحتاجها عرض إجراءات الصفحة. */
export interface BranchRequestAccess {
  /**
   * يعيد قرار كل فرع بقراءة صلاحيات واحدة مع نفس العضويات والمنح وحماية المالك في الطلب المفرد.
   * مفاتيح النتيجة هي المعرّفات الصحيحة بأحرف صغيرة؛ الفرع المجهول أو الأجنبي مرفوض.
   *
   * @param input سياق الصفحة التي تحتاج قرارات الفروع
   * @param input.userId المستخدم الموثق
   * @param input.requestedCompany الشركة المطلوبة، تُثبت عضويته قبل دخولها
   * @param input.permission إذن واحد مطلوب لكل الفروع
   * @param input.branchParams الفروع المطلوبة، يتجاهل القيم غير الصالحة ويزيل التكرار
   */
  executeBranches(input: {
    userId: string;
    requestedCompany: unknown;
    permission: string;
    branchParams: readonly unknown[];
  }): Promise<ReadonlyMap<string, boolean>>;
}
