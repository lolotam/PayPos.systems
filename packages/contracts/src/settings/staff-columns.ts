import { z } from 'zod';

import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';

// أعمدة تطبيق الموظفات (spec 060 D-A7): rating_comments وcustomer_phone عمرهم ما يبقوا أكواد (S-9، S-12).
export const staffColumnCode = z
  .enum([
    'date',
    'time',
    'service',
    'customer_name',
    'list_price',
    'discount',
    'net',
    'share',
    'estimated_commission',
    'tip',
    'rating_average',
  ])
  .meta({ id: 'StaffColumnCode' });

// القيم الفعلية: المحفوظ أو الافتراضي (MY-Q3، MY-Q9). rating_average مش بيرجع لحد ما التقييم يرجع (FR-A08).
export const staffColumnsSettings = responseObject({
  business_id: id,
  columns: z.array(staffColumnCode),
  // true = النشاط ما اختارش، والأعمدة هي افتراضي MY-Q3.
  columns_default: z.boolean(),
  months_back: z.number().int().min(1).max(24),
  // true = النشاط ما اختارش، فالموظفة تشوف الشهر الحالي بس (MY-Q9).
  months_back_default: z.boolean(),
}).meta({ id: 'StaffColumnsSettings' });

// الأكواد نصوص هنا مش enum: كود غلط أو مكرر أو شهور برّه 1–24 لازم يرجع 422 من الدومين مش 400 (MY-19، MY-13).
// null = رجّعه للافتراضي.
export const replaceStaffColumnsInput = z
  .object({
    columns: z.array(z.string().max(64)).max(32).nullable(),
    months_back: z.number().int().min(-1000).max(1000).nullable(),
  })
  .strict()
  .meta({ id: 'ReplaceStaffColumnsInput' });

export type StaffColumnCode = z.infer<typeof staffColumnCode>;
export type StaffColumnsSettings = z.infer<typeof staffColumnsSettings>;
export type ReplaceStaffColumnsInput = z.infer<typeof replaceStaffColumnsInput>;
