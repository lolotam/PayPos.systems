'use client';
import type { Service } from '@pospay/contracts';
import type { ServiceCategoriesQuery } from '../api/use-service-categories';
import { wrapServiceGridCell } from './service-basics-fields';
import { ServiceCategoryField } from './service-category-field';
import { ServiceDurationField } from './service-duration-field';

export function ServiceAttributesFields({
  categoryQuery,
  currentCategoryId,
  currentCategory,
  grid = false,
}: {
  categoryQuery: ServiceCategoriesQuery;
  currentCategoryId: string | null;
  currentCategory: Service['category'];
  grid?: boolean;
}) {
  return (
    <>
      {wrapServiceGridCell(grid, 'short', <ServiceDurationField />)}
      {wrapServiceGridCell(
        grid,
        'standard',
        <ServiceCategoryField
          categoryQuery={categoryQuery}
          currentCategoryId={currentCategoryId}
          currentCategory={currentCategory}
        />,
      )}
    </>
  );
}
