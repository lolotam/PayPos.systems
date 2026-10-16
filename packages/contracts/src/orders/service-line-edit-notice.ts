import { z } from 'zod';
import { id } from '../scalars/id.js';
import { serviceLinePriceEditedRecipient } from '../in-app-notifications.js';

/**
 * حدث مستقل لأن notifications لا تعرف المستلمين؛ عامل orders يلحقه داخل معاملته بعد حجز صف دفتر (line, revision).
 */
export const serviceLineEditNoticeRequested = z
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
      .array(serviceLinePriceEditedRecipient.extend({ locale: z.literal('ar') }))
      .min(1)
      .max(100),
  })
  .meta({ id: 'ServiceLineEditNoticeRequested' });
export type ServiceLineEditNoticeRequested = z.infer<typeof serviceLineEditNoticeRequested>;
