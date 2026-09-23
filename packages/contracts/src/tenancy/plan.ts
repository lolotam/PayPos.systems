import { z } from 'zod';

import { nameAr, nameEn } from '../bilingual/names.js';
import { id } from '../scalars/id.js';

// بيانات مرجعية على مستوى المنصة (ADR-0003 §2.3) — مفيش company_id، والـ app بيقراها بس.
export const plan = z
  .object({
    id,
    code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    name_ar: nameAr.nullable(),
    name_en: nameEn,
    feature_flags: z.record(z.string().regex(/^[a-z][a-z0-9_.]*$/), z.boolean()),
  })
  .meta({ id: 'Plan' });

export type Plan = z.infer<typeof plan>;
