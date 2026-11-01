import { z } from 'zod';
import { responseObject } from './response-object.js';

import { id } from './scalars/id.js';
import { controlChar, withoutControlChars } from './scalars/no-control-chars.js';
import { timestamp } from './scalars/timestamp.js';

// الأطوال دي بالـ code points زي قيد قاعدة البيانات، مش بوحدات UTF-16 (S-6): سقف 254 على
// بريد فيه رمز تعبيري معناه 254 نقطة، مش 127 زوج.
function codePoints(value: string): number {
  return [...value].length;
}

const phone = z.strictObject({
  calling_code: z.string().regex(/^[1-9][0-9]{0,2}(?![\s\S])/),
  national_number: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[0-9]+(?![\s\S])/),
});

const customerName = withoutControlChars(z.string()).trim().min(1).max(200);

// النوع بيتخزن بالكود الإنجليزي؛ «ذكر» و«أنثى» نصوص عرض للشاشة في 34-pre-2، مش قيم مخزنة.
const customerGender = z.enum(['female', 'male']);

// يوم وشهر مع بعض، والسنة اختيارية: سنة من غير يوم وشهر معناها تاريخ مش معروف (CIM-13).
const customerBirthday = z.strictObject({
  day: z.number().int().min(1).max(31),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(1).max(9999).optional(),
});

// البريد بيتخزن متقص trimmed زي ما اتكتب، وده مش محتاج تاكيد (CIM-12): الـ @ والنقطة كفاية.
// فحص حروف التحكم لازم يشتغل على القيمة الخام قبل القصّ، زي اسم العميل بالظبط؛ لو اتقصّ
// الأول كان السطر الجديد في آخر البريد هيمشي ويفلت من الفحص.
const customerEmail = withoutControlChars(z.string())
  .trim()
  .refine((value) => codePoints(value) >= 3 && codePoints(value) <= 254, {
    message: 'Between 3 and 254 characters',
  })
  .refine((value) => value.includes('@') && value.includes('.'), {
    message: 'An email address needs an @ and a dot',
  })
  // المنع بيتنشر مع الأرقام في نفس الـ meta عشان العقد المنشور يبقى مكتمل لوحده.
  .meta({
    not: { type: 'string', pattern: controlChar.source },
    minLength: 3,
    maxLength: 254,
    description:
      'Between 3 and 254 code points; a literal @ and a dot are required; control characters are refused.',
  });

// ملاحظة لكل نشاط: نص حر بيحفظ سطوره الداخلية، والـ NUL مرفوض لأن Postgres مش بيخزنه أصلاً.
const customerNote = z
  .string()
  .trim()
  .refine((value) => codePoints(value) >= 1 && codePoints(value) <= 500, {
    message: 'Between 1 and 500 characters',
  })
  .refine((value) => !value.includes('\u0000'), { message: 'NUL is not allowed' })
  .meta({
    minLength: 1,
    maxLength: 500,
    description:
      'Between 1 and 500 code points; interior newlines are kept. The NUL character is refused.',
  });

// حقول الهوية والملف الشخصي؛ مسار النطاق بيزود note فوقها، ومسار الشركة مش بيقبل note (S-4).
const customerIdentityFields = {
  phone,
  name: customerName,
  locale: z.enum(['ar', 'en']),
  gender: customerGender.optional(),
  birthday: customerBirthday.optional(),
  email: customerEmail.optional(),
};

export const findOrCreateCustomerInput = z
  .strictObject(customerIdentityFields)
  .meta({ id: 'FindOrCreateCustomerInput' });

export const findOrCreateScopedCustomerInput = z
  .strictObject({ ...customerIdentityFields, note: customerNote.optional() })
  .meta({ id: 'FindOrCreateScopedCustomerInput' });

export const customer = responseObject({
  id,
  name: z.string().min(1).max(200),
  locale: z.enum(['ar', 'en']),
  opted_out: z.boolean(),
  phone: z.string().regex(/^\*{3}[0-9]{2,3}(?![\s\S])/),
}).meta({ id: 'Customer' });

export const customerProfile = responseObject({
  id,
  name: z.string().min(1).max(200),
  locale: z.enum(['ar', 'en']),
  opted_out: z.boolean(),
  phone: z.string().regex(/^\*{3}[0-9]{2,3}(?![\s\S])/),
  birthday: z
    .object({
      day: z.number().int().min(1).max(31),
      month: z.number().int().min(1).max(12),
      year: z.number().int().min(1).max(9999).nullable(),
    })
    .nullable(),
  gender: customerGender.nullable(),
  email: z.string().nullable(),
  notes: z.array(
    z.object({
      business_id: id,
      business_name_ar: z.string().nullable(),
      business_name_en: z.string(),
      note: z.string(),
      created_at: timestamp,
    }),
  ),
}).meta({ id: 'CustomerProfile' });

/** سكيما العملاء المنشورة في OpenAPI؛ الـ registry بياخدها من هنا. */
export const customerSchemas = [
  customer,
  customerProfile,
  findOrCreateCustomerInput,
  findOrCreateScopedCustomerInput,
];

export type FindOrCreateCustomerInput = z.infer<typeof findOrCreateCustomerInput>;
export type FindOrCreateScopedCustomerInput = z.infer<typeof findOrCreateScopedCustomerInput>;
export type Customer = z.infer<typeof customer>;
export type CustomerProfile = z.infer<typeof customerProfile>;
