'use client';
import type { Service } from '@pospay/contracts';
import type { ServiceCategoriesQuery } from '../api/use-service-categories';
import { ServiceCategoryField } from './service-category-field';
import { ServiceDurationField } from './service-duration-field';

export function ServiceAttributesFields({
  categoryQuery,
  currentCategoryId,
  currentCategory,
}: {
  categoryQuery: ServiceCategoriesQuery;
  currentCategoryId: string | null;
  currentCategory: Service['category'];
}) {
  return (
    <>
      <ServiceDurationField />
      <ServiceCategoryField
        categoryQuery={categoryQuery}
        currentCategoryId={currentCategoryId}
        currentCategory={currentCategory}
      />
    </>
  );
}
