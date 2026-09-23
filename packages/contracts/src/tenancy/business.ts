import { z } from 'zod';

import { currency, id, nameAr, nameEn, timeZone, timestamp } from '../common/primitives.js';

export const verticalType = z
  .enum(['restaurant', 'salon', 'laundry', 'retail', 'services'])
  .meta({ id: 'VerticalType' });

// الإعدادات بتتحدد لكل vertical في مراحل جاية (SPEC §4: settings jsonb)؛ هنا بس بنضمن إنها object.
const settings = z.record(z.string(), z.unknown());

export const business = z
  .object({
    id,
    company_id: id,
    vertical_type: verticalType,
    name_ar: nameAr.nullable(),
    name_en: nameEn,
    currency,
    timezone: timeZone,
    settings,
    created_at: timestamp,
  })
  .meta({ id: 'Business' });

// الـ company_id بييجي من الـ tenant اللي اتحقق منه، مش من الطلب (CLAUDE.md §8).
export const createBusinessInput = z
  .object({
    vertical_type: verticalType,
    name_en: nameEn,
    name_ar: nameAr.optional(),
    currency: currency.default('KWD'),
    timezone: timeZone.default('Asia/Kuwait'),
    settings: settings.default({}),
  })
  .strict()
  .meta({ id: 'CreateBusinessInput' });

export type VerticalType = z.infer<typeof verticalType>;
export type Business = z.infer<typeof business>;
export type CreateBusinessInput = z.infer<typeof createBusinessInput>;
