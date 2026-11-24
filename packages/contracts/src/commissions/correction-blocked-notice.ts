import { z } from 'zod';

import { id } from '../scalars/id.js';
import {
  commissionCorrectionBlockedRecipient,
  commissionCorrectionPeriod,
} from '../statement-notifications.js';

/** حجم مجموعة مستلمين الجرس الأقصى؛ حدث الجرس بيقبل مية مستلم كحد أقصى، والمقسّم بيستعمل نفس الحد (FR-049). */
export const commissionCorrectionBlockedNoticeGroupSize = 100;

/**
 * حدث جرس التصحيح الموقوف: بيتكتب مرة واحدة لكل مجموعة مستلمين (مئة على الأكثر)
 * في نفس معاملة تسجيل التوقف، وبيحمل الشهر ورقم المجموعة وهوية التوقف بس.
 * لا مبلغ ولا اسم موظفة ولا بيانات عميل (FR-049).
 */
export const commissionCorrectionBlockedNoticeRequested = z
  .strictObject({
    schema_version: z.literal(1),
    block_id: id,
    group_index: z.number().int().nonnegative(),
    business_id: id,
    source_period: commissionCorrectionPeriod,
    notification_recipients: z
      .array(commissionCorrectionBlockedRecipient.extend({ locale: z.literal('ar') }))
      .min(1)
      .max(commissionCorrectionBlockedNoticeGroupSize),
  })
  .meta({ id: 'CommissionCorrectionBlockedNoticeRequested' });
export type CommissionCorrectionBlockedNoticeRequested = z.infer<
  typeof commissionCorrectionBlockedNoticeRequested
>;
