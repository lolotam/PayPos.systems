import { z } from 'zod';

import { inAppBase } from './in-app-base.js';

/** شهر بصيغة YYYY-MM: شهر كشف العمولة أو شهر مصدر التصحيح الموقوف. */
export const commissionPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** معامل نص واحد: الشهر. النص آمن لأنه شهر ومعامل واحد وبلا مبلغ ولا اسم. */
const periodParameter = z.strictObject({
  name: z.literal('period'),
  type: z.literal('text'),
  value: commissionPeriod,
});

/** شهر مصدر التصحيح الموقوف بصيغة YYYY-MM؛ معامل واحد آمن بلا مبلغ ولا اسم موظفة (FR-049). */
export const commissionCorrectionPeriod = commissionPeriod;
/** معاملات جرس التصحيح الموقوف: الشهر وحده. */
export const commissionCorrectionBlockedParameters = z.tuple([periodParameter]);
/** مراجعة القالب 1 لأن نص الإيقاف ثابت؛ تغييره لاحقًا مراجعة جديدة حتى لا يُعاد تفسير الصفوف المخزنة. */
export const commissionCorrectionBlockedRecipient = z.strictObject({
  ...inAppBase,
  template_key: z.literal('commission_correction_blocked'),
  safe_parameters: commissionCorrectionBlockedParameters,
});

/** معاملات جرس الاعتماد: الشهر وحده، بلا مبلغ ولا اسم موظفة ولا اسم عميل (FR-030). */
export const statementAwaitingApprovalParameters = z.tuple([periodParameter]);
/** مراجعة القالب 1 لأن نص الإشعار ثابت؛ تغييره لاحقًا مراجعة جديدة. */
export const statementAwaitingApprovalRecipient = z.strictObject({
  ...inAppBase,
  template_key: z.literal('statement_awaiting_approval'),
  safe_parameters: statementAwaitingApprovalParameters,
});
