/**
 * بديل الاسم اللي ما لاقيناش صفه (D-21): نفس القيمة للخدمة والفرع والعميل، علشان كشف قديم ما يتوقفش
 * لما صف اتشال أو اتمسح اسمه، ومن غير ما نخترع اسم. المعرّف نفسه هو اللي بيفضل يربط الصف.
 */
export const MISSING_NAME_PLACEHOLDER = '—';

/** اسم بالعربي (اختياري) والإنجليزي، زي ما بيتخزن مع صف الكشف. */
export interface StatementNameValue {
  readonly nameAr: string | null;
  readonly nameEn: string;
}

/**
 * يكمّل خريطة أسماء بكل معرّف اتطلب: اللي له اسم بياخده، واللي ما لوش صف بياخد البديل، فالباني ما
 * بيلاقيش اسم ناقص ويرمي. الخريطة الناتجة فيها كل معرّف مطلوب بالظبط، عمره ما بيطلع فيها `null`.
 *
 * @param requested كل المعرّفات اللي الكشف بيشير لها
 * @param found الأسماء اللي القارئ لقاها
 * @param placeholder قيمة الاسم لمعرّف مالوش صف
 * @returns اسم لكل معرّف مطلوب
 */
export function completeNames<T>(
  requested: Iterable<string>,
  found: ReadonlyMap<string, T>,
  placeholder: T,
): ReadonlyMap<string, T> {
  const names = new Map<string, T>();
  for (const id of requested) names.set(id, found.get(id) ?? placeholder);
  return names;
}
