import { z } from 'zod';

import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { responseObject } from '../response-object.js';
import { commissionEstimateMoney } from './estimate.js';
import { commissionPlanDate } from './plan-versions.js';

/** شهر كشف العمولة بصيغة YYYY-MM، وسنة 0000 مرفوضة زي أي شهر في الكشف. */
export const commissionStatementPeriod = z
  .string()
  .regex(/^(?!0000-)[0-9]{4}-(0[1-9]|1[0-2])$/)
  .meta({ id: 'CommissionStatementPeriod' });

/** طرق الصرف الثلاثة من قرار CS-Q6: مع المرتب أو تحويل بنكي أو كاش. */
export const commissionStatementPaidMethod = z
  .enum(['WITH_SALARY', 'BANK_TRANSFER', 'CASH'])
  .meta({ id: 'CommissionStatementPaidMethod' });

/**
 * طلب تسجيل صرف كشف شهر: الطريقة وتاريخ الصرف اللي بيصرّحه الدافع (FR-037)،
 * والملاحظة اختيارية من قرار CS-Q6 من غير حدّ طول في القرار.
 */
export const markCommissionStatementPaidInput = z
  .strictObject({
    paid_method: commissionStatementPaidMethod,
    paid_on: commissionPlanDate,
    paid_note: z.string().min(1).optional(),
  })
  .meta({ id: 'MarkCommissionStatementPaidInput' });

/** صف صرف موظفة واحدة: الصافي الدقيق والمبلغ اللي اتصرف فعلاً بالفلوس كنص KWD (D-19). */
export const commissionStatementPaymentRow = responseObject({
  employee_id: id,
  exact_payable: commissionEstimateMoney,
  paid_amount: commissionEstimateMoney,
})
  .strict()
  .meta({ id: 'CommissionStatementPaymentRow' });

/** رد تسجيل الصرف: حالة الكشف وأعمدة الدفع ومجموع المصروف وجلس كل موظفة، وده الرد نفسه بيرجع في الإعادة. */
export const markCommissionStatementPaidResponse = responseObject({
  business_id: id,
  period: commissionStatementPeriod,
  status: z.literal('PAID'),
  paid_by: id,
  paid_at: timestamp,
  paid_on: commissionPlanDate,
  paid_method: commissionStatementPaidMethod,
  paid_note: z.string().min(1).nullable(),
  paid_total: commissionEstimateMoney,
  payments: z.array(commissionStatementPaymentRow),
})
  .strict()
  .meta({ id: 'MarkCommissionStatementPaidResponse' });

/** شهر مش معتمد: 409 لأن الرفض حالة الكشف نفسها مش جسم الطلب (CM-41). */
export const commissionStatementNotApprovedError = z
  .strictObject({
    code: z.literal('COMMISSION_STATEMENT_NOT_APPROVED'),
    message_ar: z.string().min(1),
    message_en: z.string().min(1),
  })
  .meta({ id: 'CommissionStatementNotApprovedError' });

/** شهر مدفوع بالفعل بمفتاح إعادة إرسال جديد: 409 زي شهر مش معتمد (CM-41). */
export const commissionStatementAlreadyPaidError = z
  .strictObject({
    code: z.literal('COMMISSION_STATEMENT_ALREADY_PAID'),
    message_ar: z.string().min(1),
    message_en: z.string().min(1),
  })
  .meta({ id: 'CommissionStatementAlreadyPaidError' });

/** تاريخ صرف بره نافذة FR-037: بعد النهارده أو قبل شهر الاعتماد. */
export const commissionPaidOnInvalidError = z
  .strictObject({
    code: z.literal('COMMISSION_PAID_ON_INVALID'),
    message_ar: z.string().min(1),
    message_en: z.string().min(1),
  })
  .meta({ id: 'CommissionPaidOnInvalidError' });

/** نفس مفتاح Idempotency بجسم طلب مختلف: الرفض ده 422 على المسار ده (CM-41). */
export const commissionStatementIdempotencyKeyReusedError = z
  .strictObject({
    code: z.literal('IDEMPOTENCY_KEY_REUSED'),
    message_ar: z.string().min(1),
    message_en: z.string().min(1),
  })
  .meta({ id: 'CommissionStatementIdempotencyKeyReusedError' });

export const commissionStatementPaymentSchemas = [
  commissionStatementPeriod,
  commissionStatementPaidMethod,
  markCommissionStatementPaidInput,
  commissionStatementPaymentRow,
  markCommissionStatementPaidResponse,
  commissionStatementNotApprovedError,
  commissionStatementAlreadyPaidError,
  commissionPaidOnInvalidError,
  commissionStatementIdempotencyKeyReusedError,
];

export type CommissionStatementPeriod = z.infer<typeof commissionStatementPeriod>;
export type CommissionStatementPaidMethod = z.infer<typeof commissionStatementPaidMethod>;
export type MarkCommissionStatementPaidInput = z.infer<typeof markCommissionStatementPaidInput>;
export type CommissionStatementPaymentRow = z.infer<typeof commissionStatementPaymentRow>;
export type MarkCommissionStatementPaidResponse = z.infer<
  typeof markCommissionStatementPaidResponse
>;
