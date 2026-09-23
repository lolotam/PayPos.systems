import { z } from 'zod';

import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

// إعدادات النشاط (PRD P0-T10.1). القيمة اللي بترجع هي الفعلية: الـ template لو النشاط ما غيّرهاش، وإلا بتاعته.

export const language = z.enum(['ar', 'en']).meta({ id: 'Language' });
export const calendar = z.enum(['gregorian', 'hijri']).meta({ id: 'Calendar' });

// شكل TaxRule من packages/domain (PRD D-27): النسبة نص بـ 4 خانات عشرية بالكتير (5 أو 12.5)، مش float.
export const taxRule = z
  .object({
    code: z.string().min(1).max(50),
    country_code: z.string().regex(/^[A-Z]{2}$/),
    rate: z.string().regex(/^\d+(\.\d{1,4})?$/),
    mode: z.enum(['INCLUSIVE', 'EXCLUSIVE']),
  })
  .meta({ id: 'TaxRule' });

export const businessSettings = z
  .object({
    business_id: id,
    default_language: language,
    calendar,
    // null = مفيش ضريبة (الكويت النهارده).
    tax_rule: taxRule.nullable(),
    // اللي النشاط غيّره بنفسه — الباقي جاي من الـ template.
    overridden: z.array(z.enum(['default_language', 'calendar'])),
    // null لو النشاط لسه ما غيّرش أي حاجة.
    updated_at: timestamp.nullable(),
  })
  .meta({ id: 'BusinessSettings' });

// مفتاح بقيمة = غيّره؛ مفتاح بـ null = رجّعه للـ template؛ مفتاح مش موجود = سيبه زي ما هو.
export const updateBusinessSettingsInput = z
  .object({
    default_language: language.nullable().optional(),
    calendar: calendar.nullable().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, { message: 'Nothing to update' })
  .meta({ id: 'UpdateBusinessSettingsInput' });

export type BusinessSettings = z.infer<typeof businessSettings>;
export type UpdateBusinessSettingsInput = z.infer<typeof updateBusinessSettingsInput>;
