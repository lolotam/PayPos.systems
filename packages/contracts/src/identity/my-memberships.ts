import { z } from 'zod';

import { nameAr, nameEn } from '../bilingual/names.js';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';

const roleCode = z.string().regex(/^[a-z][a-z_]{0,63}$/);

/** One active membership of the caller, with the role and scope names the cancel dialog shows. */
export const myMembership = responseObject({
  id,
  role_code: roleCode,
  role_is_system: z.boolean(),
  role_name_ar: nameAr.nullable(),
  role_name_en: nameEn,
  scope_type: z.enum(['COMPANY', 'BUSINESS', 'BRANCH']),
  scope_id: id,
  scope_name_ar: nameAr.nullable(),
  scope_name_en: nameEn,
}).meta({ id: 'MyMembership' });

export const myMembershipsResponse = responseObject({ items: z.array(myMembership) }).meta({
  id: 'MyMembershipsResponse',
});

export type MyMembership = z.infer<typeof myMembership>;
export type MyMembershipsResponse = z.infer<typeof myMembershipsResponse>;
