import { z } from 'zod';

import { lowRatingCommentRecipient, lowRatingRecipient } from '../low-rating-notifications.js';
import { id } from '../scalars/id.js';
import { withTeamAlertChannels } from '../team-alert-recipients.js';

/**
 * حدث داخلي صغير ثابت الحجم يضيفه API التقييم العام في معاملة التقييم المنخفض؛
 * لا قاعدة ولا هوية ولا اسم ولا تعليق فيه، والـ worker يقرأ الباقي من المحفوظ (spec 060 D-B9، ADR-0010 A-2).
 * النجوم 1..5 لأن العامل هو الذي يقرر البوابة ويرفض ما يخالف التقييم المحفوظ.
 */
export const lowRatingSubmitted = z.strictObject({
  schema_version: z.literal(1),
  rating_id: id,
  request_id: id,
  business_id: id,
  branch_id: id,
  stars: z.int().min(1).max(5),
});
export type LowRatingSubmitted = z.infer<typeof lowRatingSubmitted>;

/**
 * حمولة `LowRatingReceived`: مجموعة بحد ١٠٠ مستلم، والنطاق من طلب التقييم لا من الجسم.
 * القالبان يتميزان بـ template_key، وعدم خلطهما في مجموعة قرار المستهلك لا قيد في العقد.
 */
export const lowRatingReceived = z.strictObject({
  business_id: id,
  branch_id: id,
  notification_recipients: z
    .array(
      // البريد والواتساب دايمًا بقالب low_rating بدون معاملات وبدون التعليق (RT-Q9، ADR-0018 §11)؛ التعليق للجرس بس.
      withTeamAlertChannels(
        z.discriminatedUnion('template_key', [lowRatingRecipient, lowRatingCommentRecipient]),
        'low_rating',
      ),
    )
    .min(1)
    .max(100),
});
export type LowRatingReceived = z.infer<typeof lowRatingReceived>;
