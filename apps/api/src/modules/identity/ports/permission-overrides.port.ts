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
   * @param now الوقت المحقون
   */
  context(membershipId: string, terms: OverrideTerms, now: Date): Promise<PermissionEditContext>;
  /**
   * بيضيف الاستثناء بعد قفل العضوية؛ التعارض يرفض بدل إضافة ALLOW وDENY متناقضين.
   *
   * @param membershipId العضوية المقفولة
   * @param terms الاستثناء بعد التحقق
   * @param now وقت التغيير
   */
  insert(
    membershipId: string,
    terms: OverrideTerms,
    now: Date,
  ): Promise<SavedPermissionOverride | null>;
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
   */
  invalidate(companyId: string): Promise<void>;
}
