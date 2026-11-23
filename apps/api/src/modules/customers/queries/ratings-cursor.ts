import { ratingsCursorKey } from '@pospay/contracts';
import { ApiError } from '../../../shared/errors.ts';

/** موضع المؤشر في القائمة: وقت تسجيل آخر تقييم في الصفحة ومعرّفه بحروف صغيرة. */
export interface RatingsCursor {
  readonly at: string;
  readonly id: string;
}

/**
 * يفك مؤشر الصفحة التالية ويتحقق منه بنفس قاعدة لحظات الفترة (`ratingsCursorKey`)، فمؤشر برموز صالحة وتاريخ ترفضه
 * PostgreSQL يطلع 400 موحّد بدل cast فاشل بـ500. المحتوى المرفوض ما بيدخلش التشخيصات.
 *
 * @param value نص المؤشر كما وصل من العميل، أو undefined للصفحة الأولى
 * @returns الموضع، أو null للصفحة الأولى
 * @throws ApiError BAD_REQUEST لما المؤشر مش ترميز صالح أو لحظته أو معرّفه غير مقبولين
 */
export function decodeRatingsCursor(value: string | undefined): RatingsCursor | null {
  if (value === undefined) return null;
  try {
    const parsed = ratingsCursorKey.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    if (parsed.success) return { at: parsed.data.at, id: parsed.data.id.toLowerCase() };
  } catch {
    /* محتوى المؤشر ما بيدخلش التشخيصات. */
  }
  throw new ApiError('BAD_REQUEST');
}

/**
 * يرمّز موضع آخر صف في الصفحة كمؤشر للصفحة التالية.
 *
 * @param at وقت التسجيل بدقة الميكروثانية
 * @param id معرّف التقييم
 * @returns مؤشر معتم للعميل
 */
export function encodeRatingsCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify({ at, id })).toString('base64url');
}
