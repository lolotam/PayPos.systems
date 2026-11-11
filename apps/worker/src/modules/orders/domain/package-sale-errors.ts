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

/** رفض البيع بعد قراءة الحقائق المقفولة؛ النقل اللاحق يختار الحالة والترجمة. */
export type PackageSaleErrorCode =
  | 'PACKAGE_TYPE_NOT_FOUND'
  | 'PACKAGE_TYPE_REVISION_CONFLICT'
  | 'PACKAGE_SALE_QUOTE_STALE'
  | 'PACKAGE_SELLER_NOT_ELIGIBLE'
  | 'PACKAGE_SELLER_SELF_FORBIDDEN'
  | 'PACKAGE_SALE_TOO_OLD'
  | 'PACKAGE_SALE_IN_FUTURE'
  | 'PACKAGE_CUSTOMER_NOT_FOUND';

/** التفاصيل الآمنة تُحفظ عشان الاستقبال يعيد تأكيد العرض الجديد بدل بيع سعر قديم. */
export class PackageSaleError extends Error {
  /**
   * يميّز رفض قواعد البيع عن أخطاء التخزين من غير اعتماد على HTTP.
   *
   * @param code سبب رفض البيع
   * @param details تفاصيل التصحيح الآمنة مثل النسخ الحالية
   */
  constructor(
    readonly code: PackageSaleErrorCode,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'PackageSaleError';
  }
}

/** خلل داخلي في الهويات المولّدة؛ ليس رفض مدخل مستخدمة ولا كود HTTP عام. */
export class PackageSaleIdentityInvariantError extends Error {
  /** يميّز خطأ تركيب الخطة عن رفض قواعد البيع المتوقع، ويظل فشلاً داخلياً. */
  constructor() {
    super('PACKAGE_SALE_IDENTITIES_INVALID');
    this.name = 'PackageSaleIdentityInvariantError';
  }
}
