import { z } from 'zod';

import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';

/** شهر التقويم بصيغة YYYY-MM؛ سنة 0000 مرفوضة لأن to_date مش بيعرف يحوّلها. */
export const commissionEstimatePeriod = z
  .string()
  .regex(/^(?!0000-)\d{4}-(0[1-9]|1[0-2])$/)
  .meta({ id: 'CommissionEstimatePeriod' });

/** نمط المبلغ بالدينار: نص بخانة عشرية واحدة وثلاث منازل، والسالب محفوظ. */
const estimateMoneyPattern = /^-?(0|[1-9]\d{0,10})\.\d{3}$/;

/** مبلغ بالدينار: نص بخانة عشرية واحدة وثلاث منازل، والسالب محفوظ لأن العمولة ممكن تكون سالبة. */
export const commissionEstimateMoney = z
  .string()
  .regex(estimateMoneyPattern)
  .meta({ id: 'CommissionEstimateMoney' });

/**
 * نفس نمط المبلغ لكن مضمّن ومش `$ref`: OpenAPI 3.0 مش بيقبل `nullable` فوق
 * `allOf` فيه `$ref`، فالمجموع اللي ممكن يكون null لازم يطلع بنوعه ونمطه في
 * نفس السكيما. القيم-null والنمط زي ما هما في عقدة Zod.
 */
const commissionEstimateNullableMoney = z.string().regex(estimateMoneyPattern).nullable();

/** يوم العمل بصيغة YYYY-MM-DD؛ تاريخ العمل هو مفتاح الفلترة باليوم في نطاق الفروع. */
const estimateBusinessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * استعلام التقدير: الموظفة اختيارية. من غيرها بيرجع كل موظفات النشاط المرئية،
 * ومعها بيرجع الموظفة دي لو كانت مرئية أصلاً؛ الموظفة غير المرئية مفيش رد يفرق بينها
 * وبين موظفة مش موجودة (CM-23h).
 *
 * معرّف الموظفة بيتطبّع بحروف صغيرة عند الطلب، فالأحرف الكبيرة والصغيرة بتوصل
 * لنفس الموظفة بنفس النتيجة.
 */
export const commissionEstimateQuery = z
  .strictObject({
    employee_id: id.toLowerCase().optional(),
  })
  .meta({ id: 'CommissionEstimateQuery' });

/**
 * مصدر مسعَّر واحد: البند أو بيع الباقة، بمبلغه وفرع عمله ويومه. الفرع هنا هو
 *"Where the work happened" وهو بيتبان دايماً ومش بيتفلتر عليه (CS-Q24).
 * `service_id` و`service_name` بيتبانوا للصف المرئي بس: بيع الباقة مالوش خدمة.
 */
export const commissionEstimateSource = responseObject({
  source_ref: z.string().min(1),
  kind: z.enum(['COMMISSION', 'SALE']),
  amount: commissionEstimateMoney,
  source_branch_id: id,
  source_business_date: estimateBusinessDate,
  service_id: id.nullable(),
  service_name: z.string().nullable(),
}).meta({ id: 'CommissionEstimateSource' });

/** بيع الباقة المسعَّر: بائعته شايف بيعها بس لو اليوم كان ليه ارتباط بفرع من نطاقه. */
export const commissionEstimateSale = responseObject({
  sale_id: id,
  amount: commissionEstimateMoney,
  source_branch_id: id,
  source_business_date: estimateBusinessDate,
}).meta({ id: 'CommissionEstimateSale' });

/**
 * تصحيح مستلم في الشهر: بيمشي من غير تسعير (D-1) وبيبقى منفصل عن مصادر الشهر،
 * ونسبته المجمَّدة هي اللي بتحدد رؤيته (FR-040).
 */
export const commissionEstimateCorrection = responseObject({
  source_ref: z.string().min(1),
  kind: z.enum(['COMMISSION', 'SALE', 'TIP_CARD', 'TIP_CASH']),
  amount: commissionEstimateMoney,
  source_branch_id: id,
  source_business_date: estimateBusinessDate,
}).meta({ id: 'CommissionEstimateCorrection' });

/** البقشيش مقسوم بطريقة الدفع: الكارت والكاش ما بيتخلطوش في نفس السطر (FR-041). */
export const commissionEstimateTips = responseObject({
  card: commissionEstimateMoney,
  cash: commissionEstimateMoney,
}).meta({ id: 'CommissionEstimateTips' });

/**
 * المرحّل الداخل لموظفة في الشهر (D-22، BR-06): رصيد العمولة السالب ورصيد بقشيش الكارت السالب،
 * كل واحد لوحده وما بيتقاصّوش، وبيعدّوا من غير تسعير ومش داخلين في `total`. المرحّل مالوش فرع، فالقارئ
 * على مستوى الفروع بيشوف صفرين وأرقامه جزئية.
 */
const commissionEstimateCarries = responseObject({
  commission: commissionEstimateMoney,
  tip_card: commissionEstimateMoney,
});

/**
 * تقدير موظفة لشهر واحد: مصادرها المسعَّرة وبيعها وبقشيشها وتصحيحاتها المستلمة ومجموعها
 * وحالتها. `partial` بتقول إن أرقامها جزئية لأن صف من شهرها خارج نطاق فروع القارئ
 * أو إنها كانت مرتبطة بفرع من نطاقه في بعض أيام الشهر بس (CS-Q20).
 *
 * `total` هو مجموع جانب العمولة بس (البنود والبيع)، وهو null لما الشهر ما تسعّرش
 * (NO_PLAN أو NO_SALARY): المبلغ غير المحسوب بيفضل null مش صفر، عشان الصفر
 * الصحيح ما يختلطش بمبلغ ما اتحسبش (FR-021).
 */
export const commissionEstimateEmployee = responseObject({
  employee_id: id,
  name_ar: z.string().nullable(),
  name_en: z.string(),
  employee_number: z.number().int().min(1).max(999999),
  status: z.enum(['OK', 'NO_PLAN', 'NO_SALARY']),
  partial: z.boolean(),
  total: commissionEstimateNullableMoney,
  sources: z.array(commissionEstimateSource),
  sales: z.array(commissionEstimateSale),
  tips: commissionEstimateTips,
  corrections: z.array(commissionEstimateCorrection),
  carries: commissionEstimateCarries,
}).meta({ id: 'CommissionEstimateEmployee' });

/**
 * تقدير النشاط لشهر واحد: الموظفات المرئيات فقط، ومجموعهن المرئي. الموظفة
 * غير المرئية مش موجودة في الرد، مش بصفر (CS-Q20). المجموع null لو أي موظفة
 * مرئية ما تسعّرش شهرها، فالمبلغ الجزئي ما يتصدقش إنه المجموع.
 */
export const commissionEstimate = responseObject({
  business_id: id,
  period: commissionEstimatePeriod,
  employees: z.array(commissionEstimateEmployee),
  partial: z.boolean(),
  total: commissionEstimateNullableMoney,
}).meta({ id: 'CommissionEstimate' });

export const commissionEstimateSchemas = [
  commissionEstimatePeriod,
  commissionEstimateMoney,
  commissionEstimateQuery,
  commissionEstimateSource,
  commissionEstimateSale,
  commissionEstimateCorrection,
  commissionEstimateTips,
  commissionEstimateEmployee,
  commissionEstimate,
];

export type CommissionEstimatePeriod = z.infer<typeof commissionEstimatePeriod>;
export type CommissionEstimateMoney = z.infer<typeof commissionEstimateMoney>;
export type CommissionEstimateQuery = z.infer<typeof commissionEstimateQuery>;
export type CommissionEstimateSource = z.infer<typeof commissionEstimateSource>;
export type CommissionEstimateSale = z.infer<typeof commissionEstimateSale>;
export type CommissionEstimateCorrection = z.infer<typeof commissionEstimateCorrection>;
export type CommissionEstimateTips = z.infer<typeof commissionEstimateTips>;
export type CommissionEstimateEmployee = z.infer<typeof commissionEstimateEmployee>;
export type CommissionEstimate = z.infer<typeof commissionEstimate>;
