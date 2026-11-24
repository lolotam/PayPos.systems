import { z } from 'zod';

import { commissionCorrectionPeriod } from '../statement-notifications.js';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { commissionPlanDate } from './plan-versions.js';

// المؤشر base64url بسيكتو الترتيب (وقت الحفظ بالميكروثانية والمعرّف) وسياق الطلب (الشركة
// والنشاط والفلتر): أطول منهج من ده حوالين 270 حرف، و512 حد بهامش زي قايمة التجاوزات.
export const COMMISSION_BLOCKED_CORRECTION_CURSOR_MAX = 512;

export const COMMISSION_BLOCKED_CORRECTION_CURSOR_VERSION = 1;
// وقت UTC خام بالميكروثانية: الصيغة اللي بيطلعها to_char(...,'US') عن PostgreSQL.
const RAW_MICROSECONDS = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/;
const BLOCKED_CORRECTION_STATUSES = ['open', 'resolved', 'all'] as const;

/** شهر حقيقي بلا سنة صفر؛ النص الخام يظل بالميكروثانية ولا يمر عبر Date. */
export const commissionBlockedCorrectionCursorPayload = z.strictObject({
  v: z.literal(COMMISSION_BLOCKED_CORRECTION_CURSOR_VERSION),
  c: id,
  b: id,
  s: z.enum(BLOCKED_CORRECTION_STATUSES),
  t: z
    .string()
    .regex(RAW_MICROSECONDS)
    .refine((value) => commissionPlanDate.safeParse(value.slice(0, 10)).success),
  i: id,
});

const commissionBlockedCorrectionCursor = z
  .string()
  .min(1)
  .max(COMMISSION_BLOCKED_CORRECTION_CURSOR_MAX)
  .regex(/^[A-Za-z0-9_-]+$/);

/**
 * استعلام قائمة التصحيحات الموقوفة (FR-049): الفلتر والمؤشر والحدود بس، وأي مفتاح زيادة فيه 400.
 * الفلتر الافتراضي «مفتوح» عشان الشاشة بتتفتح على اللي محتاج تصليح، مش على التاريخ كله.
 */
export const commissionBlockedCorrectionListQuery = z
  .strictObject({
    status: z.enum(BLOCKED_CORRECTION_STATUSES).default('open'),
    cursor: commissionBlockedCorrectionCursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'CommissionBlockedCorrectionListQuery' });

/**
 * عنصر القائمة: هوية التوقف بس — الموظفة والشهر الموقوف وسببه والشهر المحتجز ولحظتا التسجيل والحل.
 * مفيش مبلغ ولا اسم ولا أي حاجة تانية: القايمة بلّاغ عن واجب ناقص، والشاشة اللي بتوري الأسماء
 * بند UI لاحق بيقرا الأسماء من قارئه الخاص (plan-55-2.md §8).
 */
export const commissionBlockedCorrection = responseObject({
  id,
  employee_id: id,
  source_period: commissionCorrectionPeriod,
  code: z.enum(['NO_PLAN', 'NO_SALARY']),
  target_period: commissionCorrectionPeriod,
  created_at: timestamp,
  resolved_at: timestamp.nullable(),
}).meta({ id: 'CommissionBlockedCorrection' });

/**
 * صفحة القائمة: 100 عنصر بالكتير مرتبة created_at DESC, id DESC، و`next_cursor` للصفحة الجاية
 * (null لو دي الأخيرة). الحدود مكتوبة هنا صراحةً زي قايمة التجاوزات، مش من helper الصفحات.
 */
export const commissionBlockedCorrectionList = responseObject({
  items: z.array(commissionBlockedCorrection).max(100),
  next_cursor: commissionBlockedCorrectionCursor.nullable(),
}).meta({ id: 'CommissionBlockedCorrectionList' });

export const commissionBlockedCorrectionSchemas = [
  commissionBlockedCorrectionListQuery,
  commissionBlockedCorrection,
  commissionBlockedCorrectionList,
];

export type CommissionBlockedCorrectionStatus = (typeof BLOCKED_CORRECTION_STATUSES)[number];
export type CommissionBlockedCorrectionListQuery = z.infer<
  typeof commissionBlockedCorrectionListQuery
>;
export type CommissionBlockedCorrection = z.infer<typeof commissionBlockedCorrection>;
export type CommissionBlockedCorrectionList = z.infer<typeof commissionBlockedCorrectionList>;
