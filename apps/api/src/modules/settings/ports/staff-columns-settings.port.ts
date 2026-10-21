import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';

/** أعمدة تطبيق الموظفات وعدد الشهور زي ما اتخزنوا؛ null = الافتراضي. */
export interface StoredStaffColumns {
  readonly columns: readonly string[] | null;
  readonly monthsBack: number | null;
}

/** القرايات والكتابات بتاعة إعداد الأعمدة جوه transaction واحدة في الشركة. */
export interface StaffColumnsScope {
  readonly audit: AuditTrail;
  /**
   * بيرجّع الإعداد المحفوظ مقفول لحد آخر الـ transaction، عشان قبل وبعد في الـ audit يبقوا صح مع كتابتين في نفس الوقت.
   *
   * @param businessId النشاط
   * @returns المحفوظ، أو nulls لو النشاط ما اختارش
   */
  lock(businessId: string): Promise<StoredStaffColumns>;
  /**
   * بيستبدل الأعمدة وعدد الشهور ويرجّع اللي اتخزن.
   *
   * @param businessId النشاط
   * @param value      القيم الجديدة؛ null يرجّع للافتراضي
   * @param updatedBy  المستخدم اللي غيّر
   * @returns المحفوظ بعد التغيير
   */
  save(businessId: string, value: StoredStaffColumns, updatedBy: string): Promise<StoredStaffColumns>;
}

/** بيفتح withTenant ومفتاح Idempotency-Key حوالين الاستبدال، فالإعادة بترجّع نفس الرد من غير كتابة تانية. */
export interface StaffColumnsTransactions {
  /**
   * @param command الشركة والمستخدم ومفتاح الطلب وبصمته
   * @param command.companyId   الشركة المتأكد منها
   * @param command.userId      المدير اللي بيغيّر
   * @param command.key         مفتاح Idempotency-Key
   * @param command.fingerprint بصمة الطلب
   * @param work    الشغل جوه الـ transaction، ورده هو اللي بيتخزن للإعادة
   * @returns رد الشغل أو الرد المتخزن لنفس المفتاح
   */
  run<T>(
    command: { companyId: string; userId: string; key: string; fingerprint: string },
    work: (scope: StaffColumnsScope) => Promise<T>,
  ): Promise<T>;
}
