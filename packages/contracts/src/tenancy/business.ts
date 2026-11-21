import { z } from 'zod';
import { responseObject } from '../response-object.js';

import { nameAr, nameEn } from '../bilingual/names.js';
import { country } from '../reference/country.js';
import { currency } from '../reference/currency.js';
import { timeZone } from '../reference/time-zone.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

export const verticalType = z
  .enum(['restaurant', 'salon', 'laundry', 'retail', 'services'])
  .meta({ id: 'VerticalType' });

// الإعدادات بتتحدد لكل vertical في مراحل جاية (SPEC §4: settings jsonb)؛ هنا بس بنضمن إنها object.
const settings = z.record(z.string(), z.unknown());

// مفتاح country محجوز على الإنشاء (توجيه المدير 2026-11-21 على OQ-2/B-5): صلاحية create:businesses:company
// لا تمنح تحديد الدولة، فوجود المفتاح — بقيمة صالحة أو غير صالحة — يرفض الطلب، وكل مفتاح تاني بيمرّ كما هو،
// والغياب لا يضيف شيئاً. الدولة تتحدد فقط بمسار PUT مصرّح به منفصلاً على النشاط الموجود.
const createSettings = settings.superRefine((value, ctx) => {
  if ('country' in value)
    ctx.addIssue({ code: 'custom', path: ['country'], message: 'reserved at creation' });
});

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
    settings: createSettings.default({}),
  })
  .strict()
  .meta({ id: 'CreateBusinessInput' });

// تغيير دولة النشاط: الرموز الست المقبولة فقط (OQ-3 = أ)، والإجابة بترجع الرمز المخزّن (B-6).
export const setBusinessCountryInput = z
  .strictObject({ country })
  .meta({ id: 'SetBusinessCountryInput' });

export const setBusinessCountryResult = responseObject({
    business_id: id,
    country,
  })
  .meta({ id: 'SetBusinessCountryResult' });

export type VerticalType = z.infer<typeof verticalType>;
export type Business = z.infer<typeof business>;
// اللي الـ client بيبعته (الحقول اللي ليها default اختيارية) غير اللي الـ API بياخده بعد الـ parse.
export type CreateBusinessRequest = z.input<typeof createBusinessInput>;
export type CreateBusinessInput = z.output<typeof createBusinessInput>;
export type SetBusinessCountryInput = z.infer<typeof setBusinessCountryInput>;
export type SetBusinessCountryResult = z.infer<typeof setBusinessCountryResult>;
