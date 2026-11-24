import { z } from 'zod';

import { id } from '../scalars/id.js';
import { statementAwaitingApprovalRecipient } from '../statement-notifications.js';
import { commissionPeriod } from '../statement-notifications.js';

/** حجم مجموعة مستلمين الجرس الأقصى؛ حدث الجرس بيقبل مية مستلم كحد أقصى (FR-030، ADR-0037 §5). */
export const commissionStatementNoticeGroupSize = 100;

/**
 * حدث جرس «الكشف مستني الاعتماد»: بيتكتب مرة واحدة لكل مجموعة مستلمين (مئة على الأكثر) في نفس
 * معاملة المراجعة، وبيحمل الشهر ورقم المجموعة وهوية الكشف بس.
 * المستلمون هم أصحاب صلاحية الاعتماد اللي شايفين النشاط كله وقت الحدث (FR-030، CS-Q52 = PP-227)؛
 * ولا مبلغ ولا اسم موظفة ولا اسم عميل.
 */
export const commissionStatementAwaitingApprovalRequested = z
  .strictObject({
    schema_version: z.literal(1),
    business_id: id,
    statement_id: id,
    period: commissionPeriod,
    group_index: z.number().int().nonnegative(),
    notification_recipients: z
      .array(statementAwaitingApprovalRecipient.extend({ locale: z.literal('ar') }))
      .min(1)
      .max(commissionStatementNoticeGroupSize),
  })
  .meta({ id: 'CommissionStatementAwaitingApprovalRequested' });

export type CommissionStatementAwaitingApprovalRequested = z.infer<
  typeof commissionStatementAwaitingApprovalRequested
>;
