import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';

/** الطلب صاحب رابط التقييم، بالمعلومات اللي قرار الرفض محتاجها. */
export interface RatingRequestRef {
  /** العميل صاحب الطلب — هو اللي بيتقفل وبيرفض. */
  readonly customerId: string;
  /** آخر لحظة يقبل فيها الرابط؛ بعدها يبقى غير متاح. */
  readonly expiresAt: Date;
}

/** حالة العميل تحت القفل. */
export interface LockedCustomer {
  /** وقت رفضه للتقييم قبل كده، أو null لو ما رفضش. */
  readonly optedOutAt: Date | null;
}

/** حدود المعاملة: القراءة والكتابة وسجل التدقيق كلهم جوه معاملة واحدة. */
export interface RatingOptOutScope {
  /** سجل التدقيق؛ الرفض تغيير حساس فبيتسجل بنفس المعاملة (CLAUDE.md §8). */
  readonly audit: AuditTrail;
  /**
   * يدوّر على الطلب ببصمة التوكن، من غير قفل — الطلب بيتقفل بعدين على العميل نفسه.
   *
   * @param tokenHash بصمة SHA-256 للتوكن
   * @returns الطلب لو التوكن ليه طلب، أو null
   */
  findRequest(tokenHash: Buffer): Promise<RatingRequestRef | null>;
  /**
   * يقفل صف العميل `FOR NO KEY UPDATE` ويقرأ حالة رفضه، عشان الرفض المتكرر ما يكتبش مرتين.
   *
   * @param customerId العميل صاحب الطلب
   * @returns حالة العميل تحت القفل، أو null لو الصف مش موجود
   */
  lockCustomer(customerId: string): Promise<LockedCustomer | null>;
  /**
   * يكتب وقت الرفض على العميل لو ما رفضش قبل كده.
   *
   * @param customerId العميل صاحب الطلب
   * @param at         لحظة الرفض
   * @returns true لو اتكتب صف واحد
   */
  markOptedOut(customerId: string, at: Date): Promise<boolean>;
}

/** معاملة رفض التقييم: بتعمل جوه الشركة المختارة من بادئة الرابط (ADR-0011 §1). */
export interface RatingOptOutTransactions {
  /**
   * ينفّذ العمل جوه معاملة الشركة، ويقفل الشبكة لو اتأخر.
   *
   * @param companyId الشركة المختارة من بادئة الرابط
   * @param work      عمل الرفض جوه المعاملة
   * @returns نتيجة العمل بعد نجاح المعاملة
   */
  run<T>(companyId: string, work: (scope: RatingOptOutScope) => Promise<T>): Promise<T>;
}

/**
 * القفل ما اتاخدش في الوقت: مهلة المعاملة خلصت، أو نتيجة الـ commit اتلغبطت، أو PostgreSQL
 * رفض الانتظار على القفل. الخطأ جزء من عقد المعاملة مش من HTTP — التحويل مسؤولية المستهلك.
 */
export class RatingOptOutBusyError extends Error {
  /** لا يحمل معرّف العميل ولا بصمة التوكن ولا تفاصيل الاتصال. */
  constructor() {
    super('RATING_OPT_OUT_BUSY');
    this.name = 'RatingOptOutBusyError';
  }
}
