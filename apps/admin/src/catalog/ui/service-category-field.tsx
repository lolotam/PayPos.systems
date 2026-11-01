'use client';
import type { CreateServiceInput, Service, ServiceCategoryListItem } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Label } from '@pospay/ui';
import { useController } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import {
  serviceCategoryListRefused,
  type ServiceCategoriesQuery,
} from '../api/use-service-categories';
import { serviceCategoryLabel } from '../model/service-category-label';

type ServiceCategoryFieldProps = {
  categoryQuery: ServiceCategoriesQuery;
  currentCategoryId: string | null;
  currentCategory: Service['category'];
};

function currentCategoryName(currentCategory: Service['category'], locale: Locale): string {
  return currentCategory
    ? serviceCategoryLabel(currentCategory, locale)
    : t(locale, 'catalogServices.noCategory');
}

function currentCategoryMissing(
  currentCategoryId: string | null,
  currentCategory: Service['category'],
  openCategories: readonly ServiceCategoryListItem[],
): boolean {
  return (
    currentCategory !== null &&
    currentCategoryId !== null &&
    !openCategories.some((category) => category.id === currentCategoryId)
  );
}

export function ServiceCategoryField({
  categoryQuery,
  currentCategoryId,
  currentCategory,
}: ServiceCategoryFieldProps) {
  const locale = useLocale();
  const { field } = useController<CreateServiceInput, 'category_id'>({ name: 'category_id' });
  const openCategories = categoryQuery.data ?? [];
  const refused = categoryQuery.isError && serviceCategoryListRefused(categoryQuery.error);
  const showCurrent = currentCategoryMissing(currentCategoryId, currentCategory, openCategories);
  return (
    <>
      <Label htmlFor={refused ? undefined : 'service-category'}>
        {t(locale, 'catalogServices.category')}
      </Label>
      {refused ? (
        <>
          <p>{currentCategoryName(currentCategory, locale)}</p>
          <p>
            {t(
              locale,
              currentCategoryId === null
                ? 'catalogServices.categoriesUnavailableNew'
                : 'catalogServices.categoriesUnavailable',
            )}
          </p>
        </>
      ) : (
        <select
          {...field}
          id="service-category"
          value={field.value ?? ''}
          onChange={(event) => field.onChange(event.target.value || null)}
          disabled={categoryQuery.isPending}
          className="rounded-xl border bg-background p-2 text-start"
        >
          <option value="">{t(locale, 'catalogServices.noCategory')}</option>
          {openCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {serviceCategoryLabel(category, locale)}
            </option>
          ))}
          {showCurrent && currentCategory !== null && currentCategoryId !== null ? (
            <option value={currentCategoryId}>
              {serviceCategoryLabel(currentCategory, locale)}
            </option>
          ) : null}
        </select>
      )}
      {categoryQuery.isError && !refused ? (
        <p role="alert">{envelopeMessage(categoryQuery.error, locale)}</p>
      ) : null}
    </>
  );
}
