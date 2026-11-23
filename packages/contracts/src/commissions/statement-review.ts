import { z } from 'zod';

import { responseObject } from '../response-object.js';
import { statementFingerprint } from './statement.js';

/**
 * طلب مراجعة كشف شهر (FR-029): البصمتان اللي المراجع شافهما في العرض.
 * المراجع بيرسل الاتنين، فأي تغيّر حصل بين ما شاف العرض ووقت المراجعة بيرفض الطلب
 * بدل ما يعتمد كشف مش اللي شافه.
 */
export const commissionStatementReviewInput = z
  .strictObject({
    expected_fingerprint: statementFingerprint,
    expected_statement_fingerprint: statementFingerprint,
  })
  .meta({ id: 'CommissionStatementReviewInput' });

/**
 * طلب إرجاع كشف مراجَع للمسودة (FR-031): السبب مطلوب عملياً.
 * بلا حدّ شكلي ولا قصّ هنا، حتى يصل السبب الفارغ بعد القص أو الأطول من 500 حرف للنطاق
 * فيرد 422 COMMISSION_RETURN_REASON_INVALID لا 400 — نفس قاعدة سبب رفض الخصم (FR-017، D-12)،
 * والتحقق قبل أي قفل في حالة الاستخدام.
 */
export const commissionStatementReturnInput = z
  .strictObject({
    reason: z.string(),
  })
  .meta({ id: 'CommissionStatementReturnInput' });

/** نتيجة المراجعة: الكشف بقى REVIEWED بالبصمتين اللي اتراجعوا. */
export const commissionStatementReviewResult = responseObject({
  status: z.literal('REVIEWED'),
  reviewed_fingerprint: statementFingerprint,
  reviewed_statement_fingerprint: statementFingerprint,
}).meta({ id: 'CommissionStatementReviewResult' });

/** نتيجة الإرجاع: الكشف رجع DRAFT وحقائق المراجعة اتمسحت. */
export const commissionStatementReturnResult = responseObject({
  status: z.literal('DRAFT'),
}).meta({ id: 'CommissionStatementReturnResult' });

export const commissionStatementReviewSchemas = [
  commissionStatementReviewInput,
  commissionStatementReturnInput,
  commissionStatementReviewResult,
  commissionStatementReturnResult,
];

export type CommissionStatementReviewInput = z.infer<typeof commissionStatementReviewInput>;
export type CommissionStatementReturnInput = z.infer<typeof commissionStatementReturnInput>;
export type CommissionStatementReviewResult = z.infer<typeof commissionStatementReviewResult>;
export type CommissionStatementReturnResult = z.infer<typeof commissionStatementReturnResult>;
