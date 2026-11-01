'use client';
import type { CreateServiceInput, Service, ServiceCategoryListItem } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import {
  serviceCategoryListRefused,
  type ServiceCategoriesQuery,
} from '../api/use-service-categories';

function categoryName(
  category: ServiceCategoryListItem | NonNullable<Service['category']>,
  locale: Locale,
) {
  return locale === 'ar' ? category.name_ar : category.name_en;
}

function durationFromInput(value: string): number | null {
  const text = value.trim();
  return text === '' ? null : Number(text);
}

function currentCategoryName(currentCategory: Service['category'], locale: Locale): string {
  return currentCategory
    ? categoryName(currentCategory, locale)
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

export function ServiceAttributesFields({
  categoryQuery,
  currentCategoryId,
  currentCategory,
}: {
  categoryQuery: ServiceCategoriesQuery;
  currentCategoryId: string | null;
  currentCategory: Service['category'];
}) {
  const locale = useLocale();
  const {
    register,
    formState: { errors },
  } = useFormContext<CreateServiceInput>();
  const openCategories = categoryQuery.data ?? [];
  const refused = categoryQuery.isError && serviceCategoryListRefused(categoryQuery.error);
  const showCurrent = currentCategoryMissing(currentCategoryId, currentCategory, openCategories);
  return (
    <>
      <Label htmlFor="service-duration">{t(locale, 'catalogServices.duration')}</Label>
      <Input
        id="service-duration"
        dir="ltr"
        inputMode="numeric"
        aria-invalid={!!errors.duration_minutes}
        aria-describedby={errors.duration_minutes ? 'service-duration-error' : undefined}
        {...register('duration_minutes', { setValueAs: durationFromInput })}
      />
      {errors.duration_minutes ? (
        <p id="service-duration-error">{t(locale, 'catalogServices.durationInvalid')}</p>
      ) : null}
      <Label htmlFor={refused ? undefined : 'service-category'}>
        {t(locale, 'catalogServices.category')}
      </Label>
      {refused ? (
        <>
          <p>{currentCategoryName(currentCategory, locale)}</p>
          <p>{t(locale, 'catalogServices.categoriesUnavailable')}</p>
        </>
      ) : (
        <select
          id="service-category"
          disabled={categoryQuery.isPending}
          className="rounded-xl border bg-background p-2 text-start"
          {...register('category_id', {
            setValueAs: (value: string) => value || null,
          })}
        >
          <option value="">{t(locale, 'catalogServices.noCategory')}</option>
          {openCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {categoryName(category, locale)}
            </option>
          ))}
          {showCurrent && currentCategory !== null && currentCategoryId !== null ? (
            <option value={currentCategoryId}>
              {categoryName(currentCategory, locale)}
              {currentCategory.closed_at !== null
                ? ` (${t(locale, 'catalogServices.categoryClosed')})`
                : ''}
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
