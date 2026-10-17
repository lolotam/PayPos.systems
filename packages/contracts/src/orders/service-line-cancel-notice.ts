import { z } from 'zod';
import { id } from '../scalars/id.js';
import { serviceLineCancelledRecipient } from '../in-app-notifications.js';

/**
 * حدث مستقل لأن notifications لا تعرف المستلمين؛ عامل orders يلحقه بعد حجز دفتر (line, revision).
 * الجرس بلا هوية المُلغي وبلا سبب، لأن الاثنين يُقرآن فقط من سجل الإلغاء المحروس.
 */
export const serviceLineCancelNoticeRequested = z
  .strictObject({
    schema_version: z.literal(1),
    session_id: id,
    line_id: id,
    revision: z.number().int().min(2),
    business_id: id,
    branch_id: id,
    business_date: z.iso.date(),
    business_timezone: z.string().min(1).max(255),
    notification_recipients: z
      .array(serviceLineCancelledRecipient.extend({ locale: z.literal('ar') }))
      .min(1)
      .max(100),
  })
  .meta({ id: 'ServiceLineCancelNoticeRequested' });
export type ServiceLineCancelNoticeRequested = z.infer<typeof serviceLineCancelNoticeRequested>;
