'use client';
import type { ServiceCategoryListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function ServiceCategoryFilter({
  categories,
  value,
  disabled,
  onChange,
}: {
  categories: readonly ServiceCategoryListItem[];
  value: string;
  disabled: boolean;
  onChange: (categoryId: string) => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="service-category-filter">
        {t(locale, 'catalogServices.categoryFilter')}
      </Label>
      <select
        id="service-category-filter"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="max-w-sm rounded-xl border bg-background p-2 text-start"
      >
        <option value="">{t(locale, 'catalogServices.allCategories')}</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {locale === 'ar' ? category.name_ar : category.name_en}
          </option>
        ))}
      </select>
    </div>
  );
}
