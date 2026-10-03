import type { PermissionEditContext } from '../domain/permission-edit.ts';
import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';

/** معاملة الحد الشخصي والتدقيق، بنفس ترتيب أقفال محرر الصلاحيات. */
export interface DiscountLimitScope {
  readonly audit: AuditTrail;
  /**
   * بيقفل الشركة والعضويات ثم يعيد قراءة صلاحيات المدير وصاحب الهدف بنطاق العضوية.
   *
   * @param membershipId العضوية المستهدفة
   */
  context(membershipId: string): Promise<PermissionEditContext>;
  /**
   * بيقرأ القيمة الحالية تحت القفل لتكون قيمة before في التدقيق صحيحة.
   *
   * @param membershipId العضوية المقفولة
   */
  current(membershipId: string): Promise<number | null>;
  /**
   * بيستبدل القيمة الوحيدة الحالية أو يمسحها؛ التاريخ محفوظ في التدقيق.
   *
   * @param membershipId العضوية المقفولة
   * @param limitBps القيمة الجديدة أو عدم الإعداد
   */
  save(membershipId: string, limitBps: number | null): Promise<void>;
}
/** حدود المعاملة تجعل اختبار rollback ممكنًا دون إدخال قاعدة البيانات في خطوة العمل. */
export interface DiscountLimitTransactions {
  /**
   * بيحفظ القيمة والتدقيق معًا داخل الشركة المؤكدة وبهوية المدير.
   *
   * @param companyId الشركة المؤكدة
   * @param userId المدير
   * @param work العمل الذي يجب أن ينجح كله أو يتراجع كله
   */
  run<T>(
    companyId: string,
    userId: string,
    work: (scope: DiscountLimitScope) => Promise<T>,
  ): Promise<T>;
}
