import { pushSendAuthorized } from '@pospay/contracts';
import type { Logger } from '@pospay/observability';
import type { Job } from 'bullmq';

import type { SendPush, PushSendOutcome } from '../use-cases/send-push/send-push.ts';

/**
 * ينفّذ مهمة الدفع واحدة: يحاول المحاولة المرخّصة ويسجل نتيجتها.
 * القاعدة: خطأ التنفيذ بيتحوّل لسبب محدود من غير نصّه الأصلي — الأصل ممكن يحمل رابط اتصال أو مفتاح؛
 * والنتيجة المسجّلة خمسة أرقام بس: المحاولة والاشتراك والحالة وسبب الفشل وكود المزود.
 *
 * @param send   حالة الدفع المرخّصة
 * @param logger سجل العامل
 * @returns دالة المعالجة
 */
export function pushProcessor(
  send: Pick<SendPush, 'execute'>,
  logger: Logger,
): (job: Pick<Job, 'data'>) => Promise<void> {
  return async (job) => {
    const parsed = pushSendAuthorized.safeParse(job.data);
    if (!parsed.success) throw new Error('PUSH_JOB_INVALID');
    let outcome: PushSendOutcome | null;
    try {
      outcome = await send.execute(parsed.data.company_id, parsed.data.attempt_id);
    } catch {
      throw new Error('PUSH_PROCESSING_FAILED');
    }
    if (outcome === null) return;
    logger.info(
      {
        push: {
          attemptId: outcome.attemptId,
          subscriptionId: outcome.subscriptionId,
          status: outcome.status,
          failureCode: outcome.failureCode,
          httpStatus: outcome.httpStatus,
        },
      },
      'push attempt finished',
    );
    if (outcome.vapidRejected)
      logger.warn(
        { capability: { name: 'STAFF_PUSH', outcome: 'VAPID_REJECTED' } },
        'push provider rejected the VAPID key',
      );
  };
}
