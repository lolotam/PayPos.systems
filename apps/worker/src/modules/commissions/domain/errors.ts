/**
 * حدث بند غير صالح؛ إيقافه يمنع كتابة لقطة مال أو أنصبة مشوهة ويُبقي الحدث لإصلاح منتجه.
 *
 * @param reason سبب الرفض الثابت الذي يسهّل تشخيص الحدث
 * @param lineId هوية البند عند معرفتها، أو null لخطأ في الغلاف كله
 */
export class CommissionLineEventInvalidError extends Error {
  readonly code = 'COMMISSION_LINE_EVENT_INVALID';
  readonly reason: string;
  readonly lineId: string | null;

  constructor(reason: string, lineId: string | null = null) {
    super(`Invalid commission line event: ${reason}${lineId === null ? '' : ` (${lineId})`}`);
    this.name = 'CommissionLineEventInvalidError';
    this.reason = reason;
    this.lineId = lineId;
  }
}

/**
 * النشاط غير موجود عند قراءة منطقته الزمنية؛ إيقاف الإسقاط يمنع إنشاء شهور لنشاط مجهول.
 *
 * @param businessId هوية النشاط الذي لم ترجع له قراءة tenancy صفاً
 */
export class CommissionBusinessMissingError extends Error {
  readonly code = 'COMMISSION_BUSINESS_MISSING';
  readonly businessId: string;

  constructor(businessId: string) {
    super(`Commission business is missing: ${businessId}`);
    this.name = 'CommissionBusinessMissingError';
    this.businessId = businessId;
  }
}
