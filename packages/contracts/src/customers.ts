import { z } from 'zod';
import { responseObject } from './response-object.js';

import { id } from './scalars/id.js';

// اسم العميل مايقبلش حروف التحكم (Cc = U+0000–U+001F و U+007F–U+009F). النمط بينزل مع الـ OpenAPI
// كـ pattern، والـ \p{Cc} محتاج علم u اللي مفيش له مكان في JSON Schema؛ فبنكتبه بأرقام hex.
// وقاعدة no-control-regex بترفض أكواد C0 في الـ regex literal، فالنمط مبني من قالب نصي.
const customerNamePattern = new RegExp(`^[^\\x00-\\x1F\\x7F-\\x9F]*(?![\\s\\S])`);

export const findOrCreateCustomerInput = z
  .strictObject({
    phone: z.strictObject({
      calling_code: z.string().regex(/^[1-9][0-9]{0,2}(?![\s\S])/),
      national_number: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[0-9]+(?![\s\S])/),
    }),
    name: z
      .string()
      .regex(customerNamePattern)
      .trim()
      .min(1)
      .max(200),
    locale: z.enum(['ar', 'en']),
  })
  .meta({ id: 'FindOrCreateCustomerInput' });

export const customer = responseObject({
    id,
    name: z.string().min(1).max(200),
    locale: z.enum(['ar', 'en']),
    opted_out: z.boolean(),
    phone: z.string().regex(/^\*{3}[0-9]{2,3}(?![\s\S])/),
  })
  .meta({ id: 'Customer' });

export type FindOrCreateCustomerInput = z.infer<typeof findOrCreateCustomerInput>;
export type Customer = z.infer<typeof customer>;
