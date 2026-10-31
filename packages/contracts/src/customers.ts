import { z } from 'zod';
import { responseObject } from './response-object.js';

import { id } from './scalars/id.js';
import { noControlChars } from './scalars/no-control-chars.js';

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
      .regex(noControlChars)
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
