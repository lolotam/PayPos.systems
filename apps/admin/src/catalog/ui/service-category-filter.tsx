'use client';
import { t } from '@pospay/i18n';
import { Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { ServiceCategoriesQuery } from '../api/use-service-categories';
import { serviceCategoryLabel } from '../model/service-category-label';

export function ServiceCategoryFilter({
  categoryQuery,
  value,
  onChange,
}: {
  categoryQuery: ServiceCategoriesQuery;
  value: string;
  onChange: (categoryId: string) => void;
}) {
  const locale = useLocale();
  if (categoryQuery.isError && categoryQuery.data === undefined) return null;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="service-category-filter">{t(locale, 'catalogServices.categoryFilter')}</Label>
      <select
        id="service-category-filter"
        value={value}
        disabled={categoryQuery.isPending}
        onChange={(event) => onChange(event.target.value)}
        className="max-w-sm rounded-xl border bg-background p-2 text-start"
      >
        <option value="">{t(locale, 'catalogServices.allCategories')}</option>
        {(categoryQuery.data ?? []).map((category) => (
          <option key={category.id} value={category.id}>
            {serviceCategoryLabel(category, locale)}
          </option>
        ))}
      </select>
    </div>
  );
}
