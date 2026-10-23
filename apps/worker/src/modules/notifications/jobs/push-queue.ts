import { pushSendAuthorized } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import { errorDiagnostic, type Logger } from '@pospay/observability';
import type { Queue } from 'bullmq';

import { retryDelayMs } from '../../../outbox/retry-policy.ts';

export const PUSH_SEND_QUEUE = 'push-send';

/**
 * يوجّه حدث الإذن بالفعل إلى طابور الدفع؛ أي حدث تاني بيروح للمسلّم التالي زي ما هو.
 * القاعدة: بيانات المهمة معرّفات فقط — شركة ومحاولة — لأن الوجهة والمفاتيح ما بتوصلش للطابور أبداً.
 *
 * @param queue   طابور الدفع
 * @param next    المسلّم التالي للأحداث التانية
 * @param logger  سجل العامل
 * @returns دالة التسليم
 */
export function createPushTransport(
  queue: Pick<Queue, 'add'>,
  next: (event: ClaimedEvent) => Promise<DeliveryOutcome>,
  logger: Logger,
): (event: ClaimedEvent) => Promise<DeliveryOutcome> {
  return async (event) => {
    if (event.eventType !== 'PushSendAuthorized') return next(event);
    try {
      const parsed = pushSendAuthorized.safeParse(event.payload);
      if (!parsed.success || parsed.data.company_id !== event.companyId)
        throw new TypeError('PUSH_JOB_INVALID');
      const data = parsed.data;
      // إعادة المحاولة آمنة: بعد الحيازة المحاولة مش بتتبعت تاني، والحيازة مقفولة على PENDING.
      await queue.add('send', data, {
        jobId: `${data.company_id}-${data.attempt_id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
      });
      return { delivered: true };
    } catch (error) {
      const diagnostic = errorDiagnostic(error) as { type: string; code?: string };
      const retryInMs = retryDelayMs(event.attempt);
      logger.warn(
        { event: { id: event.id, type: event.eventType, companyId: event.companyId }, err: error },
        'push enqueue failed',
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
