import { z } from 'zod';

import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { salaryAmount } from '../staff/salary.js';

/** شكل الشبكة مستقل ويطابق حقول CommissionPlan؛ التحقق هنا للشكل فقط، وقواعد الخطة الدلالية يطبقها محرك العمولة في 48-2. */
export const commissionPlanCalc = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('PCT'), bps: z.number().int() }),
    z.strictObject({ kind: z.literal('FIXED'), amount: salaryAmount }),
  ])
  .meta({ id: 'CommissionPlanCalc' });

/**
 * كتلة المكوّن (الأساسي أو بيع الباقة): مفعّلة بحساب، أو معطّلة.
 * الكتلة المعطّلة بتقبل إعدادها المحفوظ (الحساب) لأن مفتاح البناء بيقفل البلوك وبيحتفظ باللي
 * المدير كتبه؛ فالسكيما كانت أضيق من محرك العمولة وبترفض خطة المحرك بيقبلها (CM-06).
 */
export const commissionPlanComponent = z
  .discriminatedUnion('enabled', [
    z.strictObject({ enabled: z.literal(false), calc: commissionPlanCalc.optional() }),
    z.strictObject({ enabled: z.literal(true), calc: commissionPlanCalc }),
  ])
  .meta({ id: 'CommissionPlanComponent' });

export const commissionPlanThreshold = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('AMOUNT'), value: salaryAmount }),
    z.strictObject({ kind: z.literal('SESSIONS'), value: z.number().int().min(0) }),
    z.strictObject({
      kind: z.literal('SALARY_MULTIPLE'),
      value: z.string().regex(/^(0|[1-9]\d{0,3})\.\d{2}$/),
    }),
  ])
  .meta({ id: 'CommissionPlanThreshold' });

export const commissionPlanTierStep = z
  .strictObject({ from: commissionPlanThreshold, calc: commissionPlanCalc })
  .meta({ id: 'CommissionPlanTierStep' });

/**
 * كتلة الشرائح: مفعّلة بنمط ومجمّع وشرائح، أو معطّلة.
 * الكتلة المعطّلة بتقبل إعدادها المحفوظ (النمط والمجمّع والشرائح) وشرائح فاضية، لأن مفتاح البناء
 * بيقفل البلوك وبيحتفظ باللي المدير كتبه؛ وقاعدة «الشرائح لازم تكون فيه» بتنطبق بس على الكتلة
 * المفعّلة، فالسكيما كانت أضيق من محرك العمولة وبترفض خطة المحرك بيقبلها (CM-06).
 */
export const commissionPlanTiers = z
  .discriminatedUnion('enabled', [
    z.strictObject({
      enabled: z.literal(false),
      mode: z.enum(['MARGINAL', 'WHOLE']).optional(),
      accumulator: z.enum(['AMOUNT', 'SESSIONS']).optional(),
      steps: z.array(commissionPlanTierStep).optional(),
    }),
    z.strictObject({
      enabled: z.literal(true),
      mode: z.enum(['MARGINAL', 'WHOLE']),
      accumulator: z.enum(['AMOUNT', 'SESSIONS']),
      steps: z.array(commissionPlanTierStep),
    }),
  ])
  .meta({ id: 'CommissionPlanTiers' });

const commissionPlanDate = z.iso
  .date()
  .regex(/^(?!0000)/)
  .meta({ id: 'CommissionPlanDate' });
const commissionRepairPeriod = z
  .string()
  .regex(/^(?!0000-)[0-9]{4}-(0[1-9]|1[0-2])$/)
  .meta({ id: 'CommissionRepairPeriod' });

export const createCommissionPlanVersionInput = z
  .strictObject({
    effective_from: commissionPlanDate,
    whole_period: z.boolean(),
    base: commissionPlanComponent,
    tiers: commissionPlanTiers,
    package_sale: commissionPlanComponent,
  })
  .meta({ id: 'CreateCommissionPlanVersionInput' });

export const commissionPlanVersion = responseObject({
  id,
  employee_id: id,
  version: z.number().int().min(1),
  effective_from: commissionPlanDate,
  whole_period: z.boolean(),
  repair_period: commissionRepairPeriod.nullable(),
  base: commissionPlanComponent,
  tiers: commissionPlanTiers,
  package_sale: commissionPlanComponent,
  created_at: timestamp,
  created_by: id,
})
  .strict()
  .meta({ id: 'CommissionPlanVersion' });

/**
 * رقم الإصدار عمود PostgreSQL integer، فأقصى مؤشر يخرج من الجدول هو حد int32؛ قيمة أكبر بتتسرب
 * للـ SQL وتنتهي 500 بدل رفض موثق. الحد بيتولّد من الثابت ده في مخطط الطلب و`next_cursor` وسطر
 * الـ OpenAPI عشان التلاتة ما ينفصلوش.
 */
export const COMMISSION_PLAN_VERSION_CURSOR_MAX = 2147483647;

export const commissionPlanVersionList = responseObject({
  items: z.array(commissionPlanVersion),
  next_cursor: z.number().int().min(1).max(COMMISSION_PLAN_VERSION_CURSOR_MAX).nullable(),
}).meta({ id: 'CommissionPlanVersionList' });

export const commissionPlanVersionListQuery = z
  .strictObject({
    cursor: z.coerce.number().int().min(1).max(COMMISSION_PLAN_VERSION_CURSOR_MAX).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'CommissionPlanVersionListQuery' });

export const commissionPlanInvalidError = z
  .strictObject({
    code: z.literal('COMMISSION_PLAN_INVALID'),
    message_ar: z.string().min(1),
    message_en: z.string().min(1),
    details: z.strictObject({
      code: z.enum([
        'INVALID_COMBINATION',
        'MIXED_THRESHOLDS',
        'STEPS_NOT_ASCENDING',
        'NO_STEPS',
        'INVALID_CALC',
        'INVALID_THRESHOLD',
        'INVALID_PLAN',
      ]),
    }),
  })
  .meta({ id: 'CommissionPlanInvalidError' });

/**
 * رفض تاريخ بداية في الماضي (CM-07): نفس غلاف الخطأ التاني، من غير details لأن الكود ده ما
 * عندوش تفاصيل غير تاريخ البداية نفسه.
 */
export const commissionEffectiveFromPastError = z
  .strictObject({
    code: z.literal('COMMISSION_EFFECTIVE_FROM_PAST'),
    message_ar: z.string().min(1),
    message_en: z.string().min(1),
  })
  .meta({ id: 'CommissionEffectiveFromPastError' });

/**
 * رفض شهر whole_period قبل الشهر اللي النشاط بدأ فيه على PosPay: نفس غلاف الخطأ التاني، من غير
 * details لأن الكود ده ما عندوش تفاصيل غير الشهر المطلوب نفسه.
 */
export const commissionPeriodBeforeBusinessError = z
  .strictObject({
    code: z.literal('COMMISSION_PERIOD_BEFORE_BUSINESS'),
    message_ar: z.string().min(1),
    message_en: z.string().min(1),
  })
  .meta({ id: 'CommissionPeriodBeforeBusinessError' });

/**
 * إعادة نفس Idempotency-Key مع جسم طلب مختلف: الرفض ده 422 على المسار ده، فبيدخل نفس
 * الاتحاد، من غير details.
 */
export const commissionPlanIdempotencyKeyReusedError = z
  .strictObject({
    code: z.literal('IDEMPOTENCY_KEY_REUSED'),
    message_ar: z.string().min(1),
    message_en: z.string().min(1),
  })
  .meta({ id: 'CommissionPlanIdempotencyKeyReusedError' });

export const commissionPlanVersionSchemas = [
  commissionPlanCalc,
  commissionPlanComponent,
  commissionPlanThreshold,
  commissionPlanTierStep,
  commissionPlanTiers,
  commissionPlanDate,
  commissionRepairPeriod,
  createCommissionPlanVersionInput,
  commissionPlanVersion,
  commissionPlanVersionList,
  commissionPlanVersionListQuery,
  commissionPlanInvalidError,
  commissionEffectiveFromPastError,
  commissionPeriodBeforeBusinessError,
  commissionPlanIdempotencyKeyReusedError,
];

export type CommissionPlanCalc = z.infer<typeof commissionPlanCalc>;
export type CommissionPlanComponent = z.infer<typeof commissionPlanComponent>;
export type CommissionPlanThreshold = z.infer<typeof commissionPlanThreshold>;
export type CommissionPlanTierStep = z.infer<typeof commissionPlanTierStep>;
export type CommissionPlanTiers = z.infer<typeof commissionPlanTiers>;
export type CreateCommissionPlanVersionInput = z.infer<typeof createCommissionPlanVersionInput>;
export type CommissionPlanVersion = z.infer<typeof commissionPlanVersion>;
export type CommissionPlanVersionList = z.infer<typeof commissionPlanVersionList>;
export type CommissionPlanVersionListQuery = z.infer<typeof commissionPlanVersionListQuery>;
export type CommissionEffectiveFromPastError = z.infer<typeof commissionEffectiveFromPastError>;
export type CommissionPeriodBeforeBusinessError = z.infer<
  typeof commissionPeriodBeforeBusinessError
>;
export type CommissionPlanIdempotencyKeyReusedError = z.infer<
  typeof commissionPlanIdempotencyKeyReusedError
>;
