import { z } from 'zod';

import { nameAr, nameEn } from '../bilingual/names.js';
import { currency } from '../reference/currency.js';
import { timeZone } from '../reference/time-zone.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

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
// اللي الـ client بيبعته (الحقول اللي ليها default اختيارية) غير اللي الـ API بياخده بعد الـ parse.
export type CreateBusinessRequest = z.input<typeof createBusinessInput>;
export type CreateBusinessInput = z.output<typeof createBusinessInput>;
