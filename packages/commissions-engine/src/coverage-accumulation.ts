import type { CoverageComparison } from './coverage-comparison.ts';

/** قائمة محدودة السقف: العدد الكامل والعناصر المعروضة وهل قُصّت. */
export interface CappedList<T> {
  readonly total: number;
  readonly items: readonly T[];
  readonly truncated: boolean;
}

/** إجماليات تغطية البنود: عدد المفحوص وقائمتا الناقص والمتأخر. */
export interface CoverageTotals {
  readonly checked: number;
  readonly missing: CappedList<string>;
  readonly stale: CappedList<string>;
}

/** إجماليات الأحداث غير المستهلكة: عدد المفحوص والقائمة المحدودة. */
export interface UnmarkedTotals<T> {
  readonly checked: number;
  readonly unmarked: CappedList<T>;
}

/**
 * قائمة محدودة فارغة، وهي الأساس اللي بتتراكم عليه الصفحات.
 *
 * @returns قائمة فارغة بعدد صفر وبلا قصّ
 */
export function emptyCappedList<T>(): CappedList<T> {
  return { total: 0, items: [], truncated: false };
}

/**
 * يضيف عناصر إلى قائمة محدودة السقف، والسقف بيقصّ المعروض من غير ما يخفي العدد الكامل.
 *
 * @param list القائمة الحالية
 * @param additions العناصر الجديدة
 * @param limit أقصى عدد عناصر معروضة في القائمة
 * @returns قائمة جديدة بالعدد الكامل والعناصر المقصوصة
 */
export function appendCapped<T>(
  list: CappedList<T>,
  additions: readonly T[],
  limit: number,
): CappedList<T> {
  const items = [...list.items, ...additions];
  return {
    total: list.total + additions.length,
    items: items.slice(0, limit),
    truncated: list.truncated || items.length > limit,
  };
}

/**
 * إجماليات تغطية فارغة، الأساس اللي بتراكم عليه مقارنات المصدر والإسقاط.
 *
 * @returns إجماليات صفرية بقائمتين فارغتين
 */
export function emptyCoverageTotals(): CoverageTotals {
  return {
    checked: 0,
    missing: emptyCappedList<string>(),
    stale: emptyCappedList<string>(),
  };
}

/**
 * يضيف مقارنة واحدة إلى إجماليات التغطية من غير ما يعدّل الإجماليات اللي اتدخّلت.
 *
 * @param totals الإجماليات الحالية
 * @param comparison مقارنة الصفحة مع الإسقاط
 * @param limit أقصى عدد هوية معروضة في كل قائمة
 * @returns إجماليات جديدة بعدد المفحوص والقائمتين المحدودتين
 */
export function addComparison(
  totals: CoverageTotals,
  comparison: CoverageComparison,
  limit: number,
): CoverageTotals {
  return {
    checked: totals.checked + comparison.checked,
    missing: appendCapped(totals.missing, comparison.missing, limit),
    stale: appendCapped(totals.stale, comparison.stale, limit),
  };
}

/**
 * إجماليات أحداث غير مستهلكة فارغة، الأساس اللي بتراكم عليه صفحات الأحداث المحتفظ بها.
 *
 * @returns إجماليات صفرية بقائمة فارغة
 */
export function emptyUnmarkedTotals<T>(): UnmarkedTotals<T> {
  return { checked: 0, unmarked: emptyCappedList<T>() };
}

/**
 * يضيف صفحة أحداث محتفظ بها إلى إجماليات غير المستهلكة من غير ما يعدّل الإجماليات اللي اتدخّلت.
 *
 * @param totals الإجماليات الحالية
 * @param checkedInPage عدد أحداث الصفحة المفحوصة
 * @param unmarked أحداث الصفحة غير المستهلكة
 * @param limit أقصى عدد حدث معروض في القائمة
 * @returns إجماليات جديدة بعدد المفحوص والقائمة المحدودة
 */
export function addUnmarkedPage<T>(
  totals: UnmarkedTotals<T>,
  checkedInPage: number,
  unmarked: readonly T[],
  limit: number,
): UnmarkedTotals<T> {
  return {
    checked: totals.checked + checkedInPage,
    unmarked: appendCapped(totals.unmarked, unmarked, limit),
  };
}
