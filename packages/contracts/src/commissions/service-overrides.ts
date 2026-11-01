import { z } from 'zod';

import { serviceCommissionRule, serviceCommissionRuleView } from '../catalog/service.js';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { commissionPlanDate } from './plan-versions.js';

// المؤشر نص base64url معتم (1..512 حرف) مش رقم، زي بقية المؤشرات في الباكدج
// (discount-approval و service-session-edits). نفس الحدود دي بتقفل `next_cursor` في الرد،
// عشان العميل مينفعش يبعت مؤشر أطول أو أوسع من اللي السيرفر بيصدره.
const commissionServiceOverrideCursor = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);

/**
 * جسم إنشاء تجاوز عمولة لخدمة على موظف (FR-011): الخدمة والقاعدة وتاريخ البداية بس.
 * الجسم صارم: التجاوز مالوش `whole_period` (FR-012)، فمفتاح زي ده لازم يرجع 400 بدل ما يتجاهل.
 * القاعدة نفسها مش متعرّفة من جديد هنا: بناخدها من الكتالوج عشان السطر المحفوظ يبقى بنفس
 * الصيغة اللي المحرك بيقراها في سطر السجل.
 */
export const createCommissionServiceOverrideInput = z
  .strictObject({
    service_id: id,
    rule: serviceCommissionRule,
    effective_from: commissionPlanDate,
  })
  .meta({ id: 'CreateCommissionServiceOverrideInput' });

/**
 * السطر المحفوظ: القاعدة المحفوظة وتاريخ البداية ولحظة الحفظ ومين حفظها.
 * الرد بيحتفظ بسلوك `responseObject` (المفتاح الزيادة يتشال في المتصفح ويتقفل في اختبارات الـ API)،
 * فمفيش `.strict()` هنا زي ما بقية الردود.
 */
export const commissionServiceOverride = responseObject({
  id,
  employee_id: id,
  service_id: id,
  rule: serviceCommissionRuleView,
  effective_from: commissionPlanDate,
  created_at: timestamp,
  created_by: id,
}).meta({ id: 'CommissionServiceOverride' });

/**
 * استعلام القائمة (FR-013): الخدمة اختيارية (كل الخدمات ولا خدمة واحدة)، والمؤشر والحدود
 * زي بقية القوائم. الاستعلام صارم: أي مفتاح زيادة فيه 400.
 */
export const commissionServiceOverrideListQuery = z
  .strictObject({
    service_id: id.optional(),
    cursor: commissionServiceOverrideCursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'CommissionServiceOverrideListQuery' });

/**
 * عنصر القائمة: السطر المحفوظ زائد `is_current` — يعني السطر اللي المحرك بيطبّقه النهاردة على
 * الخدمة دي. العلامة دي بتحسبها السيرفر من تاريخها هي، والعميل مينفعش يعيد حسابها ولا يستنتج حالة
 * تانية من التاريخ بنفسه. تاريخ البداية المحفوظ بيفضل موجود للصفوف الجاية كمان.
 */
export const commissionServiceOverrideListItem = responseObject({
  ...commissionServiceOverride.shape,
  is_current: z.boolean(),
}).meta({ id: 'CommissionServiceOverrideListItem' });

/**
 * صفحة القائمة: 100 عنصر بالكتير، و`next_cursor` بنفس حدود المؤشر (null لو دي الأخيرة).
 * helper `page` في الباكدج مش بيقفل عدد العناصر ولا طول المؤشر، فحدود الصفحة مكتوبة هنا صراحةً.
 */
export const commissionServiceOverrideList = responseObject({
  items: z.array(commissionServiceOverrideListItem).max(100),
  next_cursor: commissionServiceOverrideCursor.nullable(),
}).meta({ id: 'CommissionServiceOverrideList' });

// السكيماات المنشورة الجديدة بس: `CommissionPlanDate` و`ServiceCommissionRule` متسجلين قبل كده
// في التسجيل العام، والتجاوز بيستخدم قاعدة الكتالوج نفسها من غير مكوّن قاعدة منفصل.
export const commissionServiceOverrideSchemas = [
  createCommissionServiceOverrideInput,
  commissionServiceOverride,
  commissionServiceOverrideListQuery,
  commissionServiceOverrideListItem,
  commissionServiceOverrideList,
];

export type CommissionServiceOverrideRuleView = z.infer<typeof serviceCommissionRuleView>;
export type CreateCommissionServiceOverrideInput = z.infer<
  typeof createCommissionServiceOverrideInput
>;
export type CommissionServiceOverride = z.infer<typeof commissionServiceOverride>;
export type CommissionServiceOverrideListQuery = z.infer<typeof commissionServiceOverrideListQuery>;
export type CommissionServiceOverrideListItem = z.infer<typeof commissionServiceOverrideListItem>;
export type CommissionServiceOverrideList = z.infer<typeof commissionServiceOverrideList>;
