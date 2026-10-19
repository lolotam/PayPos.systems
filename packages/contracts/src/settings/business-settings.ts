import { z } from 'zod';
import { responseObject } from '../response-object.js';

import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { discountLimitBps } from '../identity/discount-limit.js';

// إعدادات النشاط (PRD P0-T10.1). القيمة اللي بترجع هي الفعلية: الـ template لو النشاط ما غيّرهاش، وإلا بتاعته.

export const language = z.enum(['ar', 'en']).meta({ id: 'Language' });
export const calendar = z.enum(['gregorian', 'hijri']).meta({ id: 'Calendar' });

// شكل TaxRule من packages/domain (PRD D-27): النسبة نص بـ 4 خانات عشرية بالكتير (5 أو 12.5)، مش float.
export const taxRule = responseObject({
    code: z.string().min(1).max(50),
    country_code: z.string().regex(/^[A-Z]{2}$/),
    rate: z.string().regex(/^\d+(\.\d{1,4})?$/),
    mode: z.enum(['INCLUSIVE', 'EXCLUSIVE']),
  })
  .meta({ id: 'TaxRule' });

export const businessSettings = responseObject({
    business_id: id,
    default_language: language,
    calendar,
    limit_bps: discountLimitBps.nullable(),
    // null = مفيش ضريبة (الكويت النهارده).
    tax_rule: taxRule.nullable(),
    // قيم مخزنة مش fallback: null = لسه ما اتكتبش، ومش جزء من overridden.
    official_name_ar: z.string().nullable(),
    official_name_en: z.string().nullable(),
    logo_file_id: id.nullable(),
    // اللي النشاط غيّره بنفسه — الباقي جاي من الـ template.
    overridden: z.array(z.enum(['default_language', 'calendar', 'limit_bps'])),
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

// القص والطول بعدد حروف Postgres قاعدتهم في normalizeOfficialName، والعقد بيعيدهم لأن الحزمة مش بتستورد الدومين.
// NUL قبل القص: Postgres بيرفضه بـ 22021 ولو وصل الدرايفر بيطلع 500 بدل 400.
const officialNameText = z
  .string()
  .refine((value) => !value.includes('\u0000'))
  .transform((value) => value.trim())
  .refine((value) => {
    const length = [...value].length;
    return length >= 1 && length <= 255;
  })
  .meta({ minLength: 1, maxLength: 255 });

export const updateBusinessIdentityNamesInput = z
  .object({
    official_name_ar: officialNameText.nullable().optional(),
    official_name_en: officialNameText.nullable().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, { message: 'Nothing to update' })
  .meta({ id: 'UpdateBusinessIdentityNamesInput', minProperties: 1 });

export const businessIdentityNames = responseObject({
  official_name_ar: z.string().nullable(),
  official_name_en: z.string().nullable(),
})
  .meta({ id: 'BusinessIdentityNames' });

// قراءة شاشة الهوية: null = لسه ما اتكتبش. غياب صف الإعدادات ثلاثة nulls، والقراءة ما بتنشئش صف.
export const businessIdentity = responseObject({
  official_name_ar: z.string().nullable(),
  official_name_en: z.string().nullable(),
  logo_file_id: id.nullable(),
}).meta({ id: 'BusinessIdentity' });

// null يشيل الشعار. المفتاح مطلوب: غيابه مش إزالة.
export const setBusinessLogoInput = z
  .object({
    file_id: id.nullable(),
  })
  .strict()
  .meta({ id: 'SetBusinessLogoInput' });

export const businessLogo = responseObject({
  logo_file_id: id.nullable(),
}).meta({ id: 'BusinessLogo' });

export const identityCapability = responseObject({
  can_manage_identity: z.boolean(),
}).meta({ id: 'IdentityCapability' });

export type BusinessSettings = z.infer<typeof businessSettings>;
export type UpdateBusinessSettingsInput = z.infer<typeof updateBusinessSettingsInput>;
export type UpdateBusinessIdentityNamesInput = z.infer<typeof updateBusinessIdentityNamesInput>;
export type BusinessIdentityNames = z.infer<typeof businessIdentityNames>;
export type BusinessIdentity = z.infer<typeof businessIdentity>;
export type SetBusinessLogoInput = z.infer<typeof setBusinessLogoInput>;
export type BusinessLogo = z.infer<typeof businessLogo>;
export type IdentityCapability = z.infer<typeof identityCapability>;
