import { z } from 'zod';
import { responseObject } from '../response-object.js';

import { page } from '../pagination/cursor.js';
import { id } from '../scalars/id.js';
import { withoutControlChars } from '../scalars/no-control-chars.js';

const packageNameEn = withoutControlChars(z.string()).trim().min(1).max(255);
const packageNameAr = packageNameEn;
const price = z.string().regex(/^(0|[1-9]\d{0,10})\.\d{3}$/);
const revision = z.number().int().min(1).max(2_147_483_646);

export const sellablePackageComponent = responseObject({
  service_id: id,
  service_revision: revision,
  name_en: packageNameEn,
  name_ar: packageNameAr.nullable(),
  sessions: z.number().int().min(1).max(365),
  list_price: price,
}).meta({ id: 'SellablePackageComponent' });

export const sellablePackageType = responseObject({
  id,
  revision,
  name_en: packageNameEn,
  name_ar: packageNameAr.nullable(),
  price,
  validity_days: z.number().int().min(1).max(730),
  components: z.array(sellablePackageComponent).min(1).max(20),
}).meta({ id: 'SellablePackageType' });

export const sellablePackageTypePage = page(sellablePackageType).meta({
  id: 'SellablePackageTypePage',
});

export const sellablePackageTypeListQuery = z
  .strictObject({
    cursor: id.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'SellablePackageTypeListQuery' });

export const sellablePackageTypeSchemas = [
  sellablePackageComponent,
  sellablePackageType,
  sellablePackageTypePage,
  sellablePackageTypeListQuery,
];

export type SellablePackageComponent = z.infer<typeof sellablePackageComponent>;
export type SellablePackageType = z.infer<typeof sellablePackageType>;
export type SellablePackageTypePage = z.infer<typeof sellablePackageTypePage>;
export type SellablePackageTypeListQuery = z.infer<typeof sellablePackageTypeListQuery>;
