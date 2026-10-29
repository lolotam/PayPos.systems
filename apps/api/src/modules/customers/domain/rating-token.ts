/**
 * رابط التقييم العام بعد الفك: بادئة الشركة والجزء العشوائي (ADR-0011 §1).
 * التوكن نفسه ما بيتبعتش ولا بيتسجّل: بنتحقق من صيغته وبنخزّن بصمته بس.
 */
export interface RatingToken {
  /** الشركة المختارة من بادئة الرابط — هي اللي بيتحقق منها قبل أي وصول للبيانات. */
  readonly companyId: string;
  /** الصيغة القانونية للـ token كاملة، وهي اللي بتتخزّن بصمتها. */
  readonly canonical: string;
}

// معرّف الشركة: UUID v7 قياسي بحروف صغيرة. البادئة بتختار الشركة، فأي صيغة تانية مرفوضة.
const COMPANY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// الجزء العشوائي: 32 بايت بترميز base64url من غير padding، يعني 43 حرفاً بالظبط.
const SECRET = /^[A-Za-z0-9_-]{43}$/;
// آخر حرف بيمثّل 4 بتات حقيقية و2 بتات صفر، فلازم البتّين الأخيرين فيه صفر.
// دي القيم اللي mod 4 = 0 في أبجدية base64url.
const SECRET_LAST_CHARACTER = /^[AEIMQUYcgkosw048]$/;

/**
 * يفك رابط التقييم العام وبيأكد صيغته، قبل أي وصول لقاعدة البيانات (ADR-0011 §4).
 * الصيغة المقبولة وحدها: `<معرّف شركة بحروف صغيرة>.<43 حرفاً عشوائية>`، وآخر حرف فيها
 * بيتّين الأخيرين فيه صفر — وده اللي بيميّز الترميز الصحيح عن أي نص عشوائي بنفس الطول.
 * أي حاجة تانية (حرف كبير، أقواس، مسافات، `=` أو `+` أو `/`، نقطتين) مرفوضة برد موحّد.
 *
 * @param raw التوكن كما وصل في الهيدر
 * @returns الشركة والصيغة القانونية، أو null إذا كان التوكن مش بصيغته
 */
export function parseRatingToken(raw: string): RatingToken | null {
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [companyId, secret] = parts;
  if (companyId === undefined || secret === undefined) return null;
  if (!COMPANY_UUID.test(companyId)) return null;
  if (!SECRET.test(secret)) return null;
  if (!SECRET_LAST_CHARACTER.test(secret.slice(-1))) return null;
  return { companyId, canonical: `${companyId}.${secret}` };
}
