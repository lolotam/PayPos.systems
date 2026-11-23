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
 * طلب إرجاع كشف مراجَع للمسودة (FR-031): السبب مطلوب ومقصوصة، من حرف لحد 500.
 * السبب بيتحقق في العقد، فالسطر الفاضي أو الطويل بيرجع 422 قبل أي قفل.
 */
export const commissionStatementReturnInput = z
  .strictObject({
    reason: z.string().trim().min(1).max(500),
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
