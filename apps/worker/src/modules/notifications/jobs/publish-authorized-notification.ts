import { notificationSendAuthorized } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import { errorDiagnostic, type Logger } from '@pospay/observability';
import type { Queue } from 'bullmq';

import { retryDelayMs } from '../../../outbox/retry-policy.ts';

export const NOTIFICATIONS_QUEUE = 'notifications-send';

export function createNotificationTransport(
  queue: Pick<Queue, 'add'>,
  businessDeliver: (event: ClaimedEvent) => Promise<DeliveryOutcome>,
  logger: Logger,
): (event: ClaimedEvent) => Promise<DeliveryOutcome> {
  return async (event) => {
    if (event.eventType !== 'NotificationSendAuthorized') return businessDeliver(event);
    try {
      const parsed = notificationSendAuthorized.safeParse(event.payload);
      if (!parsed.success || parsed.data.company_id !== event.companyId)
        throw new TypeError('NOTIFICATION_JOB_INVALID');
      const data = parsed.data;
      await queue.add('send', data, {
        jobId: `${data.company_id}-${data.attempt_id}`,
        attempts: 1,
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
      });
      return { delivered: true };
    } catch (error) {
      const diagnostic = errorDiagnostic(error) as { type: string; code?: string };
      const retryInMs = retryDelayMs(event.attempt);
      logger.warn(
        { event: { id: event.id, type: event.eventType, companyId: event.companyId }, err: error },
        'notification enqueue failed',
      );
      return {
        delivered: false,
        error:
          diagnostic.code === undefined ? diagnostic.type : `${diagnostic.type}:${diagnostic.code}`,
        retryInMs,
      };
    }
  };
}
