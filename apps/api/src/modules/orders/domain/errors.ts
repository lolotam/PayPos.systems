/** أسباب رفض قواعد الباقة مستقلة عن HTTP، عشان نفس الحساب يشتغل من غير سيرفر. */
export type PackageErrorCode =
  | 'INVALID_PRICE'
  | 'INVALID_COMPONENTS'
  | 'DUPLICATE_SERVICE'
  | 'INVALID_SESSIONS'
  | 'INVALID_REMAINING_SESSIONS'
  | 'INVALID_SLOTS'
  | 'INVALID_DATE'
  | 'PACKAGE_EXPIRED'
  | 'INSUFFICIENT_SLOTS';

/** خطأ مسمّى؛ طبقة النقل اللاحقة مسؤولة عن الرسالة العربية والإنجليزية. */
export class PackageRuleError extends Error {
  /**
   * بيثبت سبب الرفض عشان المستهلك يفرّق بين المدخل غير الصالح ونفاد الجلسات.
   *
   * @param code سبب الرفض
   */
  constructor(public readonly code: PackageErrorCode) {
    super(code);
    this.name = 'PackageRuleError';
  }
}

/** أسباب رفض تسعير بيع الباقة؛ محلية لهذه الوحدة فسجل أخطاء الطلب ما اتغيّرش. */
export type PackageSalePricingErrorCode = 'PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT' | 'INVALID_LIMIT';

/**
 * خطأ مسمّى بيفصل رفض بيع الباقة عن رفض بند الزيارة، والنقل هو المسؤول عن الرسالة والحالة.
 */
export class PackageSalePricingError extends Error {
  /**
   * يثبّت سبب الرفض وحدّ المسجّلة بالوحدات الأساسية عشان شاشة البيع تعرض السبب.
   *
   * @param code سبب الرفض
   * @param details حدّ المسجّلة ونسبة الخصم المحسوبة بالوحدات الأساسية
   */
  constructor(
    readonly code: PackageSalePricingErrorCode,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'PackageSalePricingError';
  }
}
