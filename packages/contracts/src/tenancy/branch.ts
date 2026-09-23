import { z } from 'zod';

import { nameAr, nameEn } from '../bilingual/names.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { openingHours } from './opening-hours.js';

// العنوان نص حر بالعربي والإنجليزي (قرار Waleed 2026-09-23)، مش عنوان كويتي منظم.
const address = z.string().trim().min(1).max(500);

export const geo = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .meta({ id: 'GeoPoint' });

export const branch = z
  .object({
    id,
    company_id: id,
    business_id: id,
    name_ar: nameAr.nullable(),
    name_en: nameEn,
    address_ar: address.nullable(),
    address_en: address.nullable(),
    geo: geo.nullable(),
    opening_hours: openingHours.nullable(),
    is_active: z.boolean(),
    created_at: timestamp,
  })
  .meta({ id: 'Branch' });

// الـ business جاي من الـ path (POST /v1/businesses/:businessId/branches) عشان الصلاحية تتقيّم عند الـ business ده،
// والـ guard بيتأكد إنه تبع نفس الشركة قبل أي كتابة؛ الـ FK المركّب (T5) هو الخط التاني.
export const createBranchInput = z
  .object({
    name_en: nameEn,
    name_ar: nameAr.optional(),
    address_ar: address.optional(),
    address_en: address.optional(),
    geo: geo.optional(),
    opening_hours: openingHours.optional(),
  })
  .strict()
  .meta({ id: 'CreateBranchInput' });

export type Branch = z.infer<typeof branch>;
export type CreateBranchInput = z.input<typeof createBranchInput>;
