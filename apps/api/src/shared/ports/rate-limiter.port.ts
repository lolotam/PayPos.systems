/**
 * حد لعدد المحاولات في Redis (CLAUDE.md §8، ADR-0003 §6) — لكل route عام أو حساس.
 */
export interface RateLimiter {
  /**
   * بيحسب محاولة واحدة للمفتاح ده في الشباك الحالي.
   * ردّ Redis بيتحقق منه قبل الاعتماد عليه: لو الرد ناقص أو مشوّه أو فيه خطأ في أمر،
   * بنرمي RateLimiterUnavailableError والطلب ما يعدّش — العدّ الغلط أحسن من إننا نفتح الباب لطلبات فوق السقف.
   * فشل الاتصال نفسه بيوصل زي ما هو من غير تغليف، عشان كل مستهلك يبلّغ عنه بطريقته هو.
   *
   * @param key           مين بيحاول وعلى إيه (مثلاً عنوان الـ IP واسم الـ route)
   * @param limit         أقصى عدد في الشباك
   * @param windowSeconds طول الشباك
   * @returns true لو لسه في الحد، false لو عدّاه
   * @throws RateLimiterUnavailableError لو Redis رجّع ردّاً مش صالح للعدّ
   */
  hit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
  /**
   * يثبت اكتمال المفتاح حتى لا تُحتسب إعادته داخل الشباك.
   *
   * @param key المفتاح المكتمل
   * @param windowSeconds مدة بقاء العلامة
   */
  remember(key: string, windowSeconds: number): Promise<void>;
  /**
   * يميّز مفتاحاً اكتمل داخل الشباك الحالي.
   *
   * @param key المفتاح المطلوب تمييزه
   * @returns true لو العلامة موجودة
   */
  remembered(key: string): Promise<boolean>;
  /**
   * يقرأ العدد الحالي بلا زيادة حتى يُحتسب الفشل بعد معرفة النتيجة.
   *
   * @param key المفتاح
   * @returns العدد في الشباك، أو صفر إن لم يبدأ
   */
  count(key: string): Promise<number>;
  /**
   * الثواني الباقية في شباك المفتاح، حتى يضبط المسار إعادة المحاولة على الشباك الحقيقي لا على قيمة ثابتة.
   *
   * @param key نفس مفتاح hit
   * @returns الثواني الباقية، أو 0 لو المفتاح غير موجود
   */
  remaining(key: string): Promise<number>;
}

/**
 * Redis الحد غير متاح: ردّ EXEC مش صالح للعدّ، أو فيه خطأ في أمر من أوامر الشباك.
 * الخطأ جزء من عقد العدّاد مش من HTTP — التحويل لبروتوكول الاستجابة مسؤولية المستهلك.
 */
export class RateLimiterUnavailableError extends Error {
  /** لا يحمل ردّ Redis ولا المفتاح ولا تفاصيل الاتصال. */
  constructor() {
    super('RATE_LIMITER_UNAVAILABLE');
  }
}
