import type { Locale } from '@pospay/i18n';

/** العربي يظهر لما الواجهة عربي وفيه اسم؛ غير كده الإنجليزي، عشان الاسم الفاضي ما يبانش فراغ. */
export function companyEmployeeNumberLabel(
  item: { name_ar: string | null; name_en: string },
  locale: Locale,
): string {
  if (locale === 'en') return item.name_en;
  const arabic = item.name_ar?.trim();
  return arabic ? arabic : item.name_en;
}
