import { z } from 'zod';

import { id } from '../scalars/id.js';
import { commissionCorrectionBlockedRecipient } from '../in-app-notifications.js';

/** شهر المصدر بصيغة YYYY-MM؛ الشهر المغلق اللي ما اتسعّرش. */
const sourcePeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

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
    source_period: sourcePeriod,
    notification_recipients: z
      .array(commissionCorrectionBlockedRecipient.extend({ locale: z.literal('ar') }))
      .min(1)
      .max(100),
  })
  .meta({ id: 'CommissionCorrectionBlockedNoticeRequested' });
export type CommissionCorrectionBlockedNoticeRequested = z.infer<
  typeof commissionCorrectionBlockedNoticeRequested
>;
