import type { PermissionEditContext, OverrideTerms } from '../domain/permission-edit.ts';
import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';

/** استثناء محفوظ، بدون أي معلومات هوية عامة. */
export interface SavedPermissionOverride extends OverrideTerms {
  readonly id: string;
  readonly granted_by: string;
  readonly granted_at: string;
}
/** حدود كتابة الاستثناء داخل نفس المعاملة التي تكتب التدقيق. */
export interface PermissionOverrideScope {
  readonly audit: AuditTrail;
  /**
   * بيقفل العضوية وبيقرأ سلطة المدير والكتالوج والهدف من الشركة نفسها لمنع الاعتماد على snapshot قديم.
   *
   * @param membershipId العضوية المستهدفة
   * @param terms الاستثناء المطلوب
   */
  context(membershipId: string, terms: OverrideTerms): Promise<PermissionEditContext>;
  /**
   * بيقرأ القرارات الحالية بعد القفل حتى يحمي سماح المالك وينهي المستبدل.
   *
   * @param membershipId العضوية المقفولة
   * @param terms مفتاح القرار المطلوب
   * @param now وقت المعاملة
   */
  current(
    membershipId: string,
    terms: OverrideTerms,
    now: Date,
  ): Promise<SavedPermissionOverride[]>;
  /**
   * بيقرأ صف السحب تحت الشركة والعضوية؛ لا يكشف صفوف شركة تانية.
   *
   * @param membershipId العضوية المستهدفة
   * @param overrideId القرار المطلوب
   */
  find(membershipId: string, overrideId: string): Promise<SavedPermissionOverride | null>;
  /**
   * بينهي القرار ويحافظ على السبب القديم؛ سبب السحب يتسجل في التدقيق.
   *
   * @param membershipId العضوية المستهدفة
   * @param overrideId القرار الجاري
   * @param now وقت الإنهاء
   */
  end(membershipId: string, overrideId: string, now: Date): Promise<SavedPermissionOverride>;
  /**
   * بيضيف القرار الجديد بعد إنهاء القرار السابق جوه نفس المعاملة.
   *
   * @param membershipId العضوية المقفولة
   * @param terms الاستثناء بعد التحقق
   * @param now وقت التغيير
   */
  insert(membershipId: string, terms: OverrideTerms, now: Date): Promise<SavedPermissionOverride>;
}
/** حدود قاعدة البيانات حتى تظل خطوة العمل قابلة للاختبار بدون Postgres. */
export interface PermissionOverrideTransactions {
  /**
   * بيدخل الشركة المؤكدة بالفاعل ويعمل commit للاستثناء والتدقيق معًا.
   *
   * @param companyId الشركة المؤكدة
   * @param userId الفاعل
   * @param work العمل داخل المعاملة
   */
  run<T>(
    companyId: string,
    userId: string,
    work: (scope: PermissionOverrideScope) => Promise<T>,
  ): Promise<T>;
}
/** إبطال مملوك للهوية؛ يشمل كل عضويات الشخص وكل نطاقاته في الشركة. */
export interface GrantInvalidator {
  /**
   * بيغير إصدار منح الشركة بعد commit؛ القارئ الحالي يقرأ قاعدة البيانات في كل طلب.
   *
   * @param companyId الشركة المتغيرة
   * @param membershipId العضوية المتغيرة؛ إصدار الشركة يبطل باقي عضويات نفس الشخص أيضًا
   */
  invalidate(companyId: string, membershipId: string): Promise<void>;
}
