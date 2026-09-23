import { z } from 'zod';

import { nameAr, nameEn } from '../bilingual/names.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

// الـ tenant root: الـ id بتاعها هو مفتاح الشركة نفسه، فمفيش company_id (ADR-0003 §2.4).
export const company = z
  .object({
    id,
    name_ar: nameAr.nullable(),
    name_en: nameEn,
    owner_user_id: id,
    plan_id: id,
    created_at: timestamp,
    deleted_at: timestamp.nullable(),
  })
  .meta({ id: 'Company' });

// الـ owner بييجي من الـ session والـ id بيتولّد جوه withNewTenant — الاتنين مش جزء من الطلب.
export const createCompanyInput = z
  .object({
    name_en: nameEn,
    name_ar: nameAr.optional(),
    plan_id: id,
  })
  .strict()
  .meta({ id: 'CreateCompanyInput' });

export type Company = z.infer<typeof company>;
export type CreateCompanyInput = z.input<typeof createCompanyInput>;
