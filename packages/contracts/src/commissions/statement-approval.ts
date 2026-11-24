import { z } from 'zod';

import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { commissionEstimatePeriod } from './estimate.js';
import { commissionPlanDate } from './plan-versions.js';
import {
  commissionStatementPaidMethod,
  commissionStatementPaymentRow,
} from './statement-payments.js';
import { commissionStatementEmployee, commissionStatementTotalMoney } from './statement.js';
import { timestamp } from '../scalars/timestamp.js';

/** بصمة SHA-256 بحروف صغيرة hex: نفس صيغة أعمدة البصمة في جدول الكشوف. */
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * طلب اعتماد الكشف: البصمتان اللي شافهما المراجع، والاعتماد بيرفض لو الكشف الحالي بيطلّعهم مختلفين (FR-032).
 * مفتاح إعادة الإرسال في الهيدر مش في الجسم.
 */
export const commissionStatementApproveRequest = z
  .strictObject({
    expected_fingerprint: fingerprint,
    expected_statement_fingerprint: fingerprint,
  })
  .meta({ id: 'CommissionStatementApproveRequest' });

/** حالة الكشف المغلق: اتعمد، أو اتصرف بعد كده (54). */
export const commissionClosedStatementStatus = z
  .enum(['APPROVED', 'PAID'])
  .meta({ id: 'CommissionClosedStatementStatus' });

/**
 * بيانات صرف كشف PAID لقارئ النشاط كله (FR-037): تاريخ الصرف الذي صرّح به الدافع وطريقته وملاحظته ومن سجّله ووقت
 * التسجيل، وصف لكل موظفة بصافيها الدقيق والمتصرف فعلاً، ومجموع المتصرف. الصافي الدقيق والمجمّد ما اتغيّرش.
 */
export const commissionClosedStatementPayment = responseObject({
  paid_on: commissionPlanDate,
  paid_method: commissionStatementPaidMethod,
  paid_note: z.string().nullable(),
  paid_at: timestamp,
  paid_by: id,
  paid_total: commissionStatementTotalMoney,
  payments: z.array(commissionStatementPaymentRow),
}).meta({ id: 'CommissionClosedStatementPayment' });

/**
 * بيانات صرف كشف PAID لقارئ فروع: تاريخ الصرف وطريقته وصفوف الموظفات المرئية بالكامل بس. من غير المجموع ولا الدافع ولا
 * الملاحظة ولا وقت التسجيل لأنها حقول على الكشف كله وبتتحسب على فروع مش مرئية ليها (CM-28c).
 */
export const commissionClosedStatementBranchPayment = responseObject({
  paid_on: commissionPlanDate,
  paid_method: commissionStatementPaidMethod,
  payments: z.array(commissionStatementPaymentRow),
}).meta({ id: 'CommissionClosedStatementBranchPayment' });

/**
 * كشف شهر مغلق لقارئ على مستوى النشاط كله، من صفوفه المجمّدة وحدها (FR-025، FR-033): من غير حساب حي ولا
 * بصمة حالية. بصمتا الاعتماد هما اللي اتجمّدتا، والاعتماد نفسه بيرجّع نفس الشكل. غياب الصرف في رد اعتماد مخزّن قديم بيتحوّل إلى null.
 */
export const commissionClosedStatementView = responseObject({
  reader_scope: z.literal('BUSINESS'),
  business_id: id,
  period: commissionEstimatePeriod,
  status: commissionClosedStatementStatus,
  approved_at: z.string().datetime({ offset: true }),
  input_fingerprint: fingerprint,
  statement_fingerprint: fingerprint,
  payment: commissionClosedStatementPayment.nullable().default(null),
  employees: z.array(commissionStatementEmployee),
}).meta({ id: 'CommissionClosedStatementView' });

/** كشف شهر مغلق لقارئ فروع: الحالة وصفوفه المرئية بس، من غير أي حقل على الكشف كله (CM-28c). */
export const commissionClosedStatementBranchView = responseObject({
  reader_scope: z.literal('BRANCHES'),
  business_id: id,
  period: commissionEstimatePeriod,
  status: commissionClosedStatementStatus,
  payment: commissionClosedStatementBranchPayment.nullable(),
  employees: z.array(commissionStatementEmployee),
}).meta({ id: 'CommissionClosedStatementBranchView' });

export const commissionStatementApprovalSchemas = [
  commissionStatementApproveRequest,
  commissionClosedStatementStatus,
  commissionClosedStatementPayment,
  commissionClosedStatementBranchPayment,
  commissionClosedStatementView,
  commissionClosedStatementBranchView,
];

export type CommissionStatementApproveRequest = z.infer<typeof commissionStatementApproveRequest>;
export type CommissionClosedStatementView = z.infer<typeof commissionClosedStatementView>;
export type CommissionClosedStatementBranchView = z.infer<
  typeof commissionClosedStatementBranchView
>;
