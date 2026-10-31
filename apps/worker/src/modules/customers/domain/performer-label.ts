/** اسم منفذ بلغتي العرض؛ null لما لا اسم آمن للعرض في اللغة. */
export interface PerformerName {
  readonly nameAr: string | null;
  readonly nameEn: string | null;
}

/** بعد هذا العدد من المنفذين تتغير التسمية إلى تسمية الفريق (RT-Q12). */
export const PERFORMER_LABEL_LIMIT = 3;

/**
 * اختيار تسمية المنفذين: إما أسماء المنفذين أو تسمية الفريق.
 * النص نفسه مش هنا — القاعدة في الـ domain والنص في الكتالوج (CLAUDE.md §7).
 */
export type PerformerLabelChoice =
  | { readonly kind: 'TEAM' }
  | { readonly kind: 'NAMES'; readonly names: readonly string[] };

/**
 * يختار تسمية المنفذين في رسالة التقييم: أسماء المنفذين لما يكونوا ثلاثة أو أقل،
 * وتسمية الفريق لما يزيد عددهم أو ما فيش منهم اسم آمن للعرض.
 *
 * @param names أسماء المنفذين بلغتي العرض
 * @param locale لغة العميل، وبها تُختار الأسماء
 * @returns الاختيار بين أسماء المنفذين وتسمية الفريق
 */
export function performerLabel(
  names: readonly PerformerName[],
  locale: 'ar' | 'en',
): PerformerLabelChoice {
  if (names.length > PERFORMER_LABEL_LIMIT) return { kind: 'TEAM' };
  const listed = names
    .map((name) => (locale === 'ar' ? (name.nameAr ?? name.nameEn) : (name.nameEn ?? name.nameAr)))
    .filter((name): name is string => name !== null && name.length > 0);
  if (listed.length === 0) return { kind: 'TEAM' };
  return { kind: 'NAMES', names: listed };
}
