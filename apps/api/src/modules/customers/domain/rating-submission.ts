import { isRatingLinkExpired } from './rating-opt-out.ts';

/**
 * حالة صفحة التقييم كما بتشوفها الزائرة: الرابط لسه مفتوح، أو التقييم اتسلم.
 */
export type RatingViewState = 'open' | 'submitted';

/**
 * بيحدد حالة صفحة التقييم من وقت استهلاك الرابط.
 * قاعدة العمل: الرابط المستهلك بيعرض «تم الإرسال» تاني، عشان الزائرة تعرف إن تقييمها وصل
 * ولازم تفضل تقدر ترفض التقييم لحد ما صلاحية الرابط تخلص (ADR-0011 §4).
 *
 * @param consumedAt وقت استهلاك الرابط، أو null لو الرابط لسه ما اتستهلكش
 * @returns `open` قبل الاستهلاك، و`submitted` بعده
 */
export function ratingViewStateOf(consumedAt: Date | null): RatingViewState {
  return consumedAt === null ? 'open' : 'submitted';
}

/**
 * بيحدد هل صفحة التقييم لسه قابلة للعرض عند اللحظة الممررة.
 * الحد بتاع الصلاحية واحد مع قرار رفض التقييم: الوصول للحظة `expires_at` نفسها يعني إن الرابط خلص.
 *
 * @param expiresAt لحظة انتهاء صلاحية رابط التقييم
 * @param now       اللحظة الحالية وقت فحص الصلاحية
 * @returns `true` لو الرابط لسه صالح للعرض
 */
export function isRatingViewable(expiresAt: Date, now: Date): boolean {
  return !isRatingLinkExpired(expiresAt, now);
}

/**
 * بيختار اسم النشاط بلغة العميل: الاسم العربي لو موجود، وإلا الاسم الإنجليزي.
 * قاعدة العمل: العميل اللي لغته عربية بيشوف الاسم العربي لو محفوظ ومش فاضي، وإلا بيشوف الإنجليزي؛
 * والعميل اللي لغته إنجليزية بيشوف الاسم الإنجليزي دايماً.
 *
 * @param locale لغة العميل وقت فتح الرابط
 * @param nameAr الاسم العربي للنشاط، أو null لو مش محفوظ
 * @param nameEn الاسم الإنجليزي للنشاط
 * @returns اسم النشاط بلغة العميل
 */
export function ratingBusinessName(
  locale: 'ar' | 'en',
  nameAr: string | null,
  nameEn: string,
): string {
  if (locale === 'en') return nameEn;
  if (nameAr !== null && nameAr.trim().length > 0) return nameAr;
  return nameEn;
}
