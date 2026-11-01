import type { ServiceCategoryListItem } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';

/**
 * نفس تسمية التصنيف بتظهر في الـpicker والفلتر والجدول، فالاسم وعلامة الإغلاق ما يختلفوش بينهم.
 *
 * @param category بيانات الاسمين ووقت إغلاق التصنيف
 * @param locale اللغة المعروضة على الشاشة
 * @returns اسم التصنيف باللغة الحالية مع علامة الإغلاق عند الحاجة
 */
export function serviceCategoryLabel(
  category: Pick<ServiceCategoryListItem, 'name_ar' | 'name_en' | 'closed_at'>,
  locale: Locale,
): string {
  const name = locale === 'ar' ? category.name_ar : category.name_en;
  return category.closed_at === null
    ? name
    : `${name} (${t(locale, 'catalogServices.categoryClosed')})`;
}
