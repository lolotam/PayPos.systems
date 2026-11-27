import { z } from 'zod';
import { id } from '../scalars/id.js';
import { lateServiceSessionRecipient } from '../in-app-notifications.js';
import { withTeamAlertChannels } from '../team-alert-recipients.js';
export const lateServiceSessionNoticeRequested = z
  .strictObject({
    schema_version: z.literal(1),
    session_id: id,
    business_id: id,
    branch_id: id,
    business_date: z.iso.date(),
    business_timezone: z.string().min(1).max(255),
    notification_recipients: z
      .array(withTeamAlertChannels(lateServiceSessionRecipient.extend({ locale: z.literal('ar') }), 'late_service_session'))
      .min(1)
      .max(100),
  })
  .meta({ id: 'LateServiceSessionNoticeRequested' });
export type LateServiceSessionNoticeRequested = z.infer<typeof lateServiceSessionNoticeRequested>;
