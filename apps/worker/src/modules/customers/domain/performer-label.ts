/** اسم منفذ بلغتي العرض؛ null لما لا اسم آمن للعرض في اللغة. */
export interface PerformerName {
  readonly nameAr: string | null;
  readonly nameEn: string | null;
}

/** بعد هذا العدد من المنفذين تتغير التسمية إلى «فريق النشاط» (RT-Q12). */
export const PERFORMER_LABEL_LIMIT = 3;

/**
 * يبني تسمية المنفذين في رسالة التقييم.
 *
 * @param names أسماء المنفذين بلغتي العرض
 * @param businessName اسم النشاط كما هو معروض
 * @param locale لغة العميل، وبها تُبنى التسمية
 * @returns الأسماء الأولى كلهم، أو تسمية «فريق النشاط» لما يزيد عددهم أو لا اسم آمن منهم
 */
export function performerLabel(
  names: readonly PerformerName[],
  businessName: string,
  locale: 'ar' | 'en',
): string {
  if (names.length > PERFORMER_LABEL_LIMIT) return teamLabel(businessName, locale);
  const listed = names
    .map((name) => (locale === 'ar' ? (name.nameAr ?? name.nameEn) : (name.nameEn ?? name.nameAr)))
    .filter((name): name is string => name !== null && name.length > 0);
  if (listed.length === 0) return teamLabel(businessName, locale);
  return listed.join(locale === 'ar' ? '، ' : ', ');
}

function teamLabel(businessName: string, locale: 'ar' | 'en'): string {
  return locale === 'ar' ? `فريق ${businessName}` : `the ${businessName} team`;
}
