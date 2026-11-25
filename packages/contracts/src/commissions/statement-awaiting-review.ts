import { z } from 'zod';

import { id } from '../scalars/id.js';
import { statementAwaitingReviewRecipient } from '../statement-notifications.js';
import { commissionPeriod } from '../statement-notifications.js';
import { commissionStatementNoticeGroupSize } from './statement-awaiting-approval.js';

/**
 * حدث جرس «الكشف مستني المراجعة»: بيتكتب مرة واحدة لكل مجموعة مستلمين (مئة على الأكثر) في نفس
 * معاملة توليد كشف الشهر، وبيحمل الشهر ورقم المجموعة وهوية الكشف بس.
 * المستلمون هم أصحاب صلاحية المراجعة اللي شايفين النشاط كله وقت الحدث (FR-055)؛
 * ولا مبلغ ولا اسم موظفة ولا اسم عميل.
 */
export const commissionStatementAwaitingReviewRequested = z
  .strictObject({
    schema_version: z.literal(1),
    business_id: id,
    statement_id: id,
    period: commissionPeriod,
    group_index: z.number().int().nonnegative(),
    notification_recipients: z
      .array(statementAwaitingReviewRecipient.extend({ locale: z.literal('ar') }))
      .min(1)
      .max(commissionStatementNoticeGroupSize),
  })
  .meta({ id: 'CommissionStatementAwaitingReviewRequested' });

export type CommissionStatementAwaitingReviewRequested = z.infer<
  typeof commissionStatementAwaitingReviewRequested
>;
