import { z } from 'zod';

import { responseObject } from '../response-object.js';
import { timeZone } from '../reference/time-zone.js';
import { id } from '../scalars/id.js';

export const COMMISSION_PLAN_EMPLOYEE_CURSOR_MAX = 12_288;

// المؤشر بيحمل مفتاح الترتيب المخزّن نفسه، فطوله تابع لأطول مفتاح يطلع من اسم 255 حرف:
// أسوأ حالة U+FDFA ×255 بتدي 4590 code units / 8415 UTF-8 bytes، والمؤشر 11411 حرف.
// 12288 حد بهامش وسطر الطلب بيفضل جوه حد ترويسات الـ API البالغ 32 KiB، ونفس الحد بيقفل
// `next_cursor` في الرد، عشان العميل مينفعش يبعت مؤشر أطول أو أوسع من اللي السيرفر بيصدره.
// مفتاح محفوظ قديم أطول من الحد ده مش بيطلّع مؤشر أطول: الصفحة بترجع 503 لحد ما البيانات تتصلح (PP-122).
const commissionPlanEmployeeCursor = z
  .string()
  .min(1)
  .max(COMMISSION_PLAN_EMPLOYEE_CURSOR_MAX)
  .regex(/^[A-Za-z0-9_-]+$/);

/**
 * استعلام قائمة موظفي الخطط (FR-010a): المؤشر والحدود بس، وأي مفتاح زيادة فيه 400.
 * الحد 50 أصغر من حد القوائم التانية لأن الشاشة بتختار موظف واحد، مش بتقرأ الجدول كله.
 */
export const commissionPlanEmployeeListQuery = z
  .strictObject({
    cursor: commissionPlanEmployeeCursor.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .meta({ id: 'CommissionPlanEmployeeListQuery' });

/**
 * عنصر القائمة: الاسم العربي والاسم الإنجليزي والرقم الوظيفي بس (CS-Q40).
 * مفيش فرع ولا دور ولا راتب ولا تليفون ولا مستند ولا ربط بالمستخدم: المحاسب بيفتح شاشة
 * الخطط من غير صلاحية الموظفين، فأي حقل موارد بشرية كان هيسرّب بيانات ما ليهاش حق عليها.
 * الأسماء نصوص خام من غير قصّ: سكيما الإدخال بتقصّ، والرد ما ينفعش يغيّر اسماً محفوظاً.
 */
export const commissionPlanEmployeeListItem = responseObject({
  id,
  name_ar: z.string().nullable(),
  name_en: z.string(),
  employee_number: z.number().int().min(1).max(999999),
}).meta({ id: 'CommissionPlanEmployeeListItem' });

/**
 * صفحة القائمة: توقيت النشاط (مش توقيت الفرع) وعناصرها ومؤشر الصفحة الجاية.
 * التوقيت هنا عشان تاريخ بداية الخطة في الشاشة يبان بنفس يوم النشاط.
 */
export const commissionPlanEmployeeList = responseObject({
  time_zone: timeZone,
  items: z.array(commissionPlanEmployeeListItem).max(50),
  next_cursor: commissionPlanEmployeeCursor.nullable(),
}).meta({ id: 'CommissionPlanEmployeeList' });

export const commissionPlanEmployeeSchemas = [
  commissionPlanEmployeeListQuery,
  commissionPlanEmployeeListItem,
  commissionPlanEmployeeList,
];

export type CommissionPlanEmployeeListQuery = z.infer<typeof commissionPlanEmployeeListQuery>;
export type CommissionPlanEmployeeListItem = z.infer<typeof commissionPlanEmployeeListItem>;
export type CommissionPlanEmployeeList = z.infer<typeof commissionPlanEmployeeList>;
