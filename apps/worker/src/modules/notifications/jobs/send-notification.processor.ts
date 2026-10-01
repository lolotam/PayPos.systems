import { notificationSendAuthorized } from '@pospay/contracts';
import type { Job } from 'bullmq';

import type { SendNotification } from '../use-cases/send-notification/send-notification.ts';

export function notificationProcessor(
  send: SendNotification,
): (job: Pick<Job, 'data'>) => Promise<void> {
  return async (job) => {
    const parsed = notificationSendAuthorized.safeParse(job.data);
    if (!parsed.success) throw new Error('NOTIFICATION_JOB_INVALID');
    try {
      await send.execute(parsed.data.company_id, parsed.data.attempt_id);
    } catch {
      throw new Error('NOTIFICATION_PROCESSING_FAILED');
    }
  };
}
