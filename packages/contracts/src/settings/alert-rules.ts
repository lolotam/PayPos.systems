import { z } from 'zod';
import { responseObject } from '../response-object.js';

import { id } from '../scalars/id.js';

// قواعد التنبيه (spec 060 FR-B16). نفس القوائم اللي في packages/domain/alert-rules.ts؛ الحزمة دي مش بتستورد الدومين.
export const alertKind = z
  .enum([
    'SHIFT_NOT_CLOCKED_IN',
    'SHIFT_BREAK_NOT_RETURNED',
    'SHIFT_BREAK_RETURNED_OTHER_BRANCH',
    'SHIFT_ENDS_SOON',
    'ATTENDANCE_EXCEPTION',
    'DOCUMENT_EXPIRING',
    'LATE_SERVICE_SESSION',
    'SERVICE_LINE_EDITED',
    'SERVICE_LINE_CANCELLED',
    'SERVICE_LINE_PERFORMERS_CHANGED',
    'ATTENDANCE_CHANGE_REQUESTED',
    'ATTENDANCE_CHANGE_DECIDED',
    'STATEMENT_AWAITING_REVIEW',
    'STATEMENT_AWAITING_APPROVAL',
  ])
  .meta({ id: 'AlertKind' });
export type AlertKindCode = z.infer<typeof alertKind>;

export const alertRecipientRole = z
  .enum(['owner', 'general_manager', 'business_manager', 'branch_manager'])
  .meta({ id: 'AlertRecipientRole' });
// IN_APP بس لحد البند 62b (AL-Q6).
export const alertChannel = z.enum(['IN_APP']).meta({ id: 'AlertChannel' });

const minutes = z.number().int().min(1).max(1440);
// رقم النسخة: عدّاد القاعدة المخزنة، بيتزود مع كل حفظ.
const revision = z.number().int().min(1).max(2_147_483_646);

export const alertFixedRecipient = responseObject({
    selector: z.enum(['PERMISSION_HOLDERS', 'CONTEXT', 'EMPLOYEE_PUSH']),
    permission: z.string().nullable(),
    who: z.enum(['REQUESTER', 'EMPLOYEE']).nullable(),
  })
  .meta({ id: 'AlertFixedRecipient' });

// القاعدة زي ما الشاشة بتعرضها: المخزنة أو الافتراضي، من غير تطبيق المفتاح العام (اللي بيرجع لوحده).
export const alertRuleView = responseObject({
    kind: alertKind,
    source: z.enum(['DEFAULT', 'BUSINESS', 'BRANCH']),
    enabled: z.boolean(),
    recipient_roles: z.array(alertRecipientRole),
    channels: z.array(alertChannel),
    delay_minutes: minutes.nullable(),
    lead_minutes: minutes.nullable(),
    // مستلمين ثابتين للنوع، للعرض بس.
    fixed_recipients: z.array(alertFixedRecipient),
    // رقم النسخة المخزنة في نطاق العرض نفسه (قاعدة النشاط في شاشة النشاط، قاعدة الفرع في شاشة الفرع)؛
    // null = مفيش قاعدة مخزنة في النطاق ده (الافتراضي، أو قاعدة النشاط في شاشة الفرع).
    revision: revision.nullable(),
  })
  .meta({ id: 'AlertRuleView' });

export const alertRules = responseObject({
    business_id: id,
    // null = قواعد النشاط؛ غير كده قواعد الفرع ده (الأنواع اللي مالهاش قاعدة فرع بترجع قاعدة النشاط).
    branch_id: id.nullable(),
    alerts_enabled: z.boolean(),
    rules: z.array(alertRuleView),
  })
  .meta({ id: 'AlertRules' });
export type AlertRules = z.infer<typeof alertRules>;

export const alertRuleInput = z
  .object({
    kind: alertKind,
    enabled: z.boolean(),
    recipient_roles: z.array(alertRecipientRole).max(4),
    channels: z.array(alertChannel).max(1),
    delay_minutes: minutes.nullable(),
    lead_minutes: minutes.nullable(),
    // رقم النسخة اللي العميل قراها قبل الحفظ (null = متوقع مفيش قاعدة مخزنة في النطاق ده بعد)؛
    // لو غير كده يبقى حد تاني عدّل القاعدة في نفس الوقت والطلب يترفض.
    expected_revision: revision.nullable(),
  })
  .strict()
  .meta({ id: 'AlertRuleInput' });

// بيكتب الأنواع اللي في الطلب بس؛ الباقي بيفضل زي ما هو.
export const setAlertRulesInput = z
  .object({ rules: z.array(alertRuleInput).min(1).max(14) })
  .strict()
  .refine((input) => new Set(input.rules.map((r) => r.kind)).size === input.rules.length, {
    message: 'Each kind at most once',
  })
  .meta({ id: 'SetAlertRulesInput' });
export type SetAlertRulesInput = z.infer<typeof setAlertRulesInput>;

export const setAlertsMasterInput = z
  .object({ alerts_enabled: z.boolean() })
  .strict()
  .meta({ id: 'SetAlertsMasterInput' });
export type SetAlertsMasterInput = z.infer<typeof setAlertsMasterInput>;
