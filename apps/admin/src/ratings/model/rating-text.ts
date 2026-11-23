import type { RatingAverageItem } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';

/** الاسم بلغة الشاشة، وبيرجع للإنجليزي لو العربي مش مسجّل. */
export function ratingName(
  person: { name_ar: string | null; name_en: string },
  locale: Locale,
): string {
  return locale === 'ar' ? (person.name_ar ?? person.name_en) : person.name_en;
}

/** الأعلى متوسطًا الأول، ثم الأكتر تقييمات، ثم الاسم: الـ API بيرجع بترتيب المعرّف فقط. */
export function sortAverages(items: readonly RatingAverageItem[], locale: Locale) {
  return [...items].sort(
    (a, b) =>
      Number(b.average) - Number(a.average) ||
      b.count - a.count ||
      ratingName(a, locale).localeCompare(ratingName(b, locale), locale),
  );
}
