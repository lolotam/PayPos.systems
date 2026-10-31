import { z } from 'zod';
import { responseObject } from '../response-object.js';

import { page } from '../pagination/cursor.js';
import { id } from '../scalars/id.js';
import { withoutControlChars } from '../scalars/no-control-chars.js';
import { timestamp } from '../scalars/timestamp.js';

const categoryName = withoutControlChars(z.string())
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
  .tuple([withoutControlChars(z.string().min(1).max(100)), id])
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

export const serviceCategoryBranchView = z
  .enum(['in_use', 'available'])
  .meta({ id: 'ServiceCategoryBranchView' });
export const serviceCategoryBranchSettingState = z
  .enum(['ENABLED', 'HIDDEN'])
  .meta({ id: 'ServiceCategoryBranchSettingState' });
export const setServiceCategoryBranchStateInput = z
  .strictObject({
    state: serviceCategoryBranchSettingState,
    expected_revision: revision.nullable(),
  })
  .meta({ id: 'SetServiceCategoryBranchStateInput' });

const branchCategoryFields = {
  ...categoryFields,
  setting_state: serviceCategoryBranchSettingState.nullable(),
  setting_revision: revision.nullable(),
};
export const serviceCategoryBranchListItem = responseObject(branchCategoryFields).meta({
  id: 'ServiceCategoryBranchListItem',
});
export const serviceCategoryBranchStateResult = responseObject(branchCategoryFields).meta({
  id: 'ServiceCategoryBranchStateResult',
});
export const serviceCategoryBranchPage = page(serviceCategoryBranchListItem)
  .extend({ next_cursor: serviceCategoryCursor.nullable() })
  .meta({ id: 'ServiceCategoryBranchPage' });
export const serviceCategoryBranchListQuery = z
  .strictObject({
    view: serviceCategoryBranchView,
    cursor: serviceCategoryCursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'ServiceCategoryBranchListQuery' });

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
  serviceCategoryBranchView,
  serviceCategoryBranchSettingState,
  setServiceCategoryBranchStateInput,
  serviceCategoryBranchListItem,
  serviceCategoryBranchStateResult,
  serviceCategoryBranchPage,
  serviceCategoryBranchListQuery,
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
export type ServiceCategoryBranchView = z.infer<typeof serviceCategoryBranchView>;
export type ServiceCategoryBranchSettingState = z.infer<
  typeof serviceCategoryBranchSettingState
>;
export type SetServiceCategoryBranchStateInput = z.infer<
  typeof setServiceCategoryBranchStateInput
>;
export type ServiceCategoryBranchListItem = z.infer<typeof serviceCategoryBranchListItem>;
export type ServiceCategoryBranchStateResult = z.infer<
  typeof serviceCategoryBranchStateResult
>;
export type ServiceCategoryBranchPage = z.infer<typeof serviceCategoryBranchPage>;
export type ServiceCategoryBranchListQuery = z.infer<
  typeof serviceCategoryBranchListQuery
>;
