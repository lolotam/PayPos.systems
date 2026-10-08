import { z } from 'zod';

import { page } from '../pagination/cursor.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

const packageNameEn = z
  .string()
  .regex(/^\P{Cc}*$/u)
  .trim()
  .min(1)
  .max(255);
const packageNameAr = packageNameEn;
const price = z.string().regex(/^(0|[1-9]\d{0,10})\.\d{3}$/);
const revision = z.number().int().min(1).max(2_147_483_646);
export const packageTypeComponentInput = z
  .strictObject({
    service_id: id,
    sessions: z.number().int().min(1).max(365),
  })
  .meta({ id: 'PackageTypeComponentInput' });
const components = z
  .array(packageTypeComponentInput)
  .min(1)
  .max(20)
  .superRefine((rows, ctx) => {
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      if (seen.has(row.service_id.toLowerCase()))
        ctx.addIssue({
          code: 'custom',
          message: 'PACKAGE_TYPE_DUPLICATE_SERVICE',
          path: [index, 'service_id'],
        });
      seen.add(row.service_id.toLowerCase());
    });
  });
const fields = {
  name_en: packageNameEn,
  name_ar: packageNameAr.nullable().optional(),
  price,
  validity_days: z.number().int().min(1).max(730),
  components,
};
export const createPackageTypeInput = z.strictObject(fields).meta({ id: 'CreatePackageTypeInput' });
export const updatePackageTypeInput = z
  .strictObject({
    ...fields,
    name_ar: packageNameAr.nullable(),
    expected_revision: revision,
  })
  .meta({ id: 'UpdatePackageTypeInput' });
export const packageTypeComponent = packageTypeComponentInput
  .extend({
    name_en: packageNameEn,
    name_ar: packageNameAr.nullable(),
    price,
  })
  .meta({ id: 'PackageTypeComponent' });
export const packageTypeDetail = z
  .object({
    id,
    business_id: id,
    name_en: packageNameEn,
    name_ar: packageNameAr.nullable(),
    price,
    validity_days: fields.validity_days,
    revision,
    components: z.array(packageTypeComponent).min(1).max(20),
    created_at: timestamp,
    updated_at: timestamp,
  })
  .meta({ id: 'PackageTypeDetail' });
export const packageTypeListItem = packageTypeDetail
  .omit({
    business_id: true,
    components: true,
    created_at: true,
    updated_at: true,
  })
  .extend({ component_count: z.number().int().min(1).max(20) })
  .meta({ id: 'PackageTypeListItem' });
export const packageTypePage = page(packageTypeListItem).meta({ id: 'PackageTypePage' });
export const packageTypeListQuery = z
  .strictObject({
    cursor: id.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'PackageTypeListQuery' });
export const packageTypeSchemas = [
  packageTypeComponentInput,
  createPackageTypeInput,
  updatePackageTypeInput,
  packageTypeComponent,
  packageTypeDetail,
  packageTypeListItem,
  packageTypePage,
  packageTypeListQuery,
];
export type CreatePackageTypeInput = z.infer<typeof createPackageTypeInput>;
export type UpdatePackageTypeInput = z.infer<typeof updatePackageTypeInput>;
export type PackageTypeDetail = z.infer<typeof packageTypeDetail>;
export type PackageTypeListItem = z.infer<typeof packageTypeListItem>;
export type PackageTypePage = z.infer<typeof packageTypePage>;
export type PackageTypeListQuery = z.infer<typeof packageTypeListQuery>;
