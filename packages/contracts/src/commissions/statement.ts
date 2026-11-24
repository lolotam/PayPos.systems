import { z } from 'zod';

import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { commissionEstimateMoney, commissionEstimatePeriod } from './estimate.js';

/**
 * مجموع مبالغ الموظفة (العمولة والبقشيش والمستحق): مجموع صفوف كل صف منها حتى `numeric(14,3)` (11 خانة صحيحة)، فقد
 * يتخطى مجموعها حد الصف الواحد. يتسع لأقصى `bigint` بالمليم (16 خانة صحيحة) لأن الباني يجمع بـ`bigint`، فلا يفشل ردٌّ
 * صحيح بعد الالتزام بسبب عدد الخانات (مراجعة PR #1259، البند 2).
 */
const statementTotalMoneyPattern = /^-?(0|[1-9]d{0,15}).d{3}$/;

/** مجموع بالدينار بنمط أوسع من مبلغ الصف الواحد. */
export const commissionStatementTotalMoney = z
  .string()
  .regex(statementTotalMoneyPattern)
  .meta({ id: 'CommissionStatementTotalMoney' });

/** تاريخ YYYY-MM-DD. */
const statementDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** بصمة SHA-256 بحروف صغيرة hex: نفس صيغة أعمدة البصمة في جدول الكشوف. */
export const statementFingerprint = z.string().regex(/^[0-9a-f]{64}$/);

/** حالة الكشف المفتوح: المغلق (APPROVED, PAID) بيرجع رفض لحد ما 53-2 تكتب صفوفه المجمّدة. */
export const commissionStatementStatus = z
  .enum(['DRAFT', 'REVIEWED'])
  .meta({ id: 'CommissionStatementStatus' });

/**
 * صف كشف: مصدر واحد بمبلغه ويوم عمله وفرعه واسم الخدمة والعميل الكامل لو البند من زيارة. العميل
 * بيتعرض باسمه الكامل من غير تليفون أبداً (FR-028، CS-Q15).
 */
export const commissionStatementRow = responseObject({
  source_ref: z.string().min(1),
  kind: z.enum([
    'COMMISSION',
    'SALE',
    'TIP_CARD',
    'TIP_CASH',
    'CORRECTION',
    'CORRECTION_TIP_CARD',
    'CORRECTION_TIP_CASH',
    'CARRY_COMMISSION',
    'CARRY_TIP_CARD',
  ]),
  amount: commissionEstimateMoney,
  previous_amount: commissionEstimateMoney.nullable(),
  new_amount: commissionEstimateMoney.nullable(),
  source_period: commissionEstimatePeriod.nullable(),
  source_branch_id: id.nullable(),
  source_branch_name_ar: z.string().nullable(),
  source_branch_name_en: z.string().nullable(),
  source_business_date: statementDate.nullable(),
  service_name_ar: z.string().nullable(),
  service_name_en: z.string().nullable(),
  customer_name: z.string().nullable(),
  business_date: statementDate.nullable(),
}).meta({ id: 'CommissionStatementRow' });

/** مشكلة بتمنع المراجعة والاعتماد: فشل تسعير الشهر، أو تصحيح موقوف مفتوح لشهر مصدر (FR-027). */
export const commissionStatementIssue = responseObject({
  kind: z.enum(['PRICING', 'BLOCKED_CORRECTION']),
  code: z.enum(['NO_PLAN', 'NO_SALARY']),
  source_period: commissionEstimatePeriod.nullable(),
}).meta({ id: 'CommissionStatementIssue' });

/**
 * موظفة في الكشف: صفوفها المرئية للقارئ ومجاميعها من الصفوف دي بس. `commission_subtotal` و`tip_side`
 * ممكن يبقوا سالبين، و`payable` عمره ما بيبقى سالب (§9، CS-Q7). `partial` بتقول إن في صف من شهرها برا
 * نطاق القارئ.
 */
export const commissionStatementEmployee = responseObject({
  employee_id: id,
  employee_number: z.number().int().min(1).max(999999),
  name_ar: z.string().nullable(),
  name_en: z.string(),
  partial: z.boolean(),
  commission_subtotal: commissionStatementTotalMoney,
  tip_side: commissionStatementTotalMoney,
  payable: commissionStatementTotalMoney,
  rows: z.array(commissionStatementRow),
  issues: z.array(commissionStatementIssue),
}).meta({ id: 'CommissionStatementEmployee' });

/**
 * كشف الشهر لقارئ على مستوى النشاط: البصمتان اللي الباني بيطلّعهم دلوقتي، وبصمتا المراجعة، وهل الكشف
 * اتغيّر من وقت المراجعة وسببه (FR-025، D-6). الشكلين منفصلين مش حقول اختيارية على شكل واحد.
 */
export const commissionStatementView = responseObject({
  reader_scope: z.literal('BUSINESS'),
  business_id: id,
  period: commissionEstimatePeriod,
  status: commissionStatementStatus,
  generated: z.boolean(),
  current_fingerprint: statementFingerprint,
  current_statement_fingerprint: statementFingerprint,
  reviewed_fingerprint: statementFingerprint.nullable(),
  reviewed_statement_fingerprint: statementFingerprint.nullable(),
  changed_since_review: z.boolean(),
  change_cause: z.enum(['INPUTS', 'STATEMENT']).nullable(),
  employees: z.array(commissionStatementEmployee),
}).meta({ id: 'CommissionStatementView' });

/**
 * كشف الشهر لقارئ على مستوى الفروع: الحالة وصفوفه المرئية بس، من غير أي حقل على الكشف كله (بصمة، `reviewed_*`،
 * علم تغيّر) لأنها محسوبة على فروع مش مرئية ليه وتكشف تغييراً فيها (FR-025، CM-28c).
 */
export const commissionStatementBranchView = responseObject({
  reader_scope: z.literal('BRANCHES'),
  business_id: id,
  period: commissionEstimatePeriod,
  status: commissionStatementStatus,
  generated: z.boolean(),
  employees: z.array(commissionStatementEmployee),
}).meta({ id: 'CommissionStatementBranchView' });

export const commissionStatementSchemas = [
  commissionStatementTotalMoney,
  commissionStatementStatus,
  commissionStatementRow,
  commissionStatementIssue,
  commissionStatementEmployee,
  commissionStatementView,
  commissionStatementBranchView,
];

export type CommissionStatementRow = z.infer<typeof commissionStatementRow>;
export type CommissionStatementIssue = z.infer<typeof commissionStatementIssue>;
export type CommissionStatementEmployee = z.infer<typeof commissionStatementEmployee>;
export type CommissionStatementView = z.infer<typeof commissionStatementView>;
export type CommissionStatementBranchView = z.infer<typeof commissionStatementBranchView>;
