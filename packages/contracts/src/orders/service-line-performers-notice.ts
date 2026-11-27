import { z } from 'zod';
import { id } from '../scalars/id.js';
import { serviceLinePerformersChangedRecipient } from '../in-app-notifications.js';
import { withTeamAlertChannels } from '../team-alert-recipients.js';

/**
 * حدث مستقل لأن notifications لا تعرف المستلمين؛ عامل orders يلحقه بعد حجز دفتر (line, revision).
 * الجرس بلا سبب وبلا اسم منفّذ وبلا هوية من غيّر، لأن الثلاثة تُقرأ فقط من سجل التغيير المحروس.
 */
export const serviceLinePerformersNoticeRequested = z
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
      .array(
        withTeamAlertChannels(
          serviceLinePerformersChangedRecipient.extend({ locale: z.literal('ar') }),
          'service_line_performers_changed',
        ),
      )
      .min(1)
      .max(100),
  })
  .meta({ id: 'ServiceLinePerformersNoticeRequested' });
export type ServiceLinePerformersNoticeRequested = z.infer<typeof serviceLinePerformersNoticeRequested>;
