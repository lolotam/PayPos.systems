import { z } from 'zod';

import { id, nameAr, nameEn, timestamp } from '../common/primitives.js';
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

// الـ business_id لازم يبقى تبع نفس الشركة — ده بيتضمن في الداتابيز بـ FK مركّب (T5)، مش هنا.
export const createBranchInput = z
  .object({
    business_id: id,
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
export type CreateBranchInput = z.infer<typeof createBranchInput>;
