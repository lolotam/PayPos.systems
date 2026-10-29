import { z } from 'zod';
import { responseObject } from '../response-object.js';

import { page } from '../pagination/cursor.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

const categoryName = z
  .string()
  .regex(/^\P{Cc}*$/u)
  .trim()
  .min(1)
  .max(100);
const revision = z.number().int().min(1).max(2_147_483_646);

export const serviceCategoryVisibility = z
  .enum(['BUSINESS', 'BRANCH'])
  .meta({ id: 'ServiceCategoryVisibility' });

export const createServiceCategoryInput = z
  .strictObject({
    name_en: categoryName,
    name_ar: categoryName,
  })
  .meta({ id: 'CreateServiceCategoryInput' });

export const createBranchServiceCategoryInput = createServiceCategoryInput
  .extend({ visibility: serviceCategoryVisibility })
  .meta({ id: 'CreateBranchServiceCategoryInput' });

export const renameServiceCategoryInput = createServiceCategoryInput
  .extend({
    visibility: serviceCategoryVisibility.optional(),
    expected_revision: revision,
  })
  .meta({ id: 'RenameServiceCategoryInput' });

const categoryFields = {
  id,
  name_en: categoryName,
  name_ar: categoryName,
  visibility: serviceCategoryVisibility,
  owner_branch_id: id.nullable(),
  closed_at: timestamp.nullable(),
  revision,
};

export const serviceCategory = responseObject(categoryFields).meta({ id: 'ServiceCategory' });
export const serviceCategoryListItem = responseObject(categoryFields).meta({
  id: 'ServiceCategoryListItem',
});
export const serviceCategoryCursorData = z
  .tuple([z.string().min(1).max(100), id])
  .meta({ id: 'ServiceCategoryCursorData' });
export const serviceCategoryCursor = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      return serviceCategoryCursorData.safeParse(JSON.parse(value)).success;
    } catch {
      return false;
    }
  })
  .meta({ id: 'ServiceCategoryCursor' });
export const serviceCategoryPage = page(serviceCategoryListItem)
  .extend({ next_cursor: serviceCategoryCursor.nullable() })
  .meta({ id: 'ServiceCategoryPage' });
export const serviceCategoryListQuery = z
  .strictObject({
    status: z.enum(['open', 'closed', 'all']).default('open'),
    cursor: serviceCategoryCursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'ServiceCategoryListQuery' });

export const serviceCategorySchemas = [
  serviceCategoryVisibility,
  createServiceCategoryInput,
  createBranchServiceCategoryInput,
  renameServiceCategoryInput,
  serviceCategory,
  serviceCategoryListItem,
  serviceCategoryCursorData,
  serviceCategoryCursor,
  serviceCategoryPage,
  serviceCategoryListQuery,
];

export type ServiceCategoryVisibility = z.infer<typeof serviceCategoryVisibility>;
export type CreateServiceCategoryInput = z.infer<typeof createServiceCategoryInput>;
export type CreateBranchServiceCategoryInput = z.infer<typeof createBranchServiceCategoryInput>;
export type RenameServiceCategoryInput = z.infer<typeof renameServiceCategoryInput>;
export type ServiceCategory = z.infer<typeof serviceCategory>;
export type ServiceCategoryListItem = z.infer<typeof serviceCategoryListItem>;
export type ServiceCategoryCursorData = z.infer<typeof serviceCategoryCursorData>;
export type ServiceCategoryPage = z.infer<typeof serviceCategoryPage>;
export type ServiceCategoryListQuery = z.infer<typeof serviceCategoryListQuery>;
