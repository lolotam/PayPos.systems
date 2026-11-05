// مشغّلو المطالبة الحقيقيون: عاملان BullMQ مستقلان على طابور واحد، عشان يتنافسوا على نفس الدور.
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import {
  closeRedisClient,
  RATING_CLAIMS_QUEUE,
  startRatingClaimsProcessor,
  type RatingClaimsTurnPort,
} from '../../modules/customers/jobs/rating-claims.processor.ts';
import type { RatingClaimsTurnSummary } from '../../modules/customers/use-cases/claim-rating-requests/claim-rating-requests.ts';

/** عامل مطالبة حقيقي: طابور وعامل BullMQ بيشغّلوا الدور على بادئة خاصة بالاختبار. */
export interface BullRunner {
  /**
   * يحط مهمة مطالبة على الطابور، والوعد ده بيتحل لما الدور اللي جواها يخلص.
   *
   * @param companyId الشركة اللي المطالبة بتاعتها مطلوبة
   * @returns وعد بيحسم بنتيجة الدور
   */
  enqueue(companyId: string): Promise<void>;
  /** ملخص كل دور خلص. */
  readonly summaries: readonly RatingClaimsTurnSummary[];
  /** الخطأ اللي حصل في كل دور وقع. */
  readonly errors: readonly unknown[];
  /** يصفّي العامل والطابور والاتصالات. */
  close(): Promise<void>;
}

/**
 * بيبني عامل مطالبة على طابور BullMQ حقيقي.
 *
 * العامل بيشغّل نفس الدور اللي في الاختبار، فالسور والبوابة اللي في منفذ الحالة
 * بتفصل بين العاملين زي ما تفصل بين عاملين حقيقيين.
 */
export async function startBullRunner(options: {
  redisUrl: string;
  prefix: string;
  turn: RatingClaimsTurnPort;
}): Promise<BullRunner> {
  const summaries: RatingClaimsTurnSummary[] = [];
  const errors: unknown[] = [];
  const settled: (() => void)[] = [];
  const turn: RatingClaimsTurnPort = {
    execute: async (companyId) => {
      try {
        const summary = await options.turn.execute(companyId);
        summaries.push(summary);
        return summary;
      } catch (error) {
        errors.push(error);
        throw error;
      } finally {
        settled.shift()?.();
      }
    },
  };
  const processor = startRatingClaimsProcessor({
    redisUrl: options.redisUrl,
    prefix: options.prefix,
    turn,
  });
  const connection = new Redis(options.redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
  connection.on('error', () => undefined);
  const queue = new Queue(RATING_CLAIMS_QUEUE, { connection, prefix: options.prefix });
  queue.on('error', () => undefined);
  await processor.ready();
  let closed = false;
  return {
    summaries,
    errors,
    enqueue: async (companyId) => {
      const done = new Promise<void>((resolve) => settled.push(resolve));
      await queue.add('claim', { companyId }, { attempts: 1 });
      return done;
    },
    close: async () => {
      // الطابور مشترك بين العاملين، فالتنظيف بيتم ببادئة الاختبار كلها مش بمفتاح واحد.
      if (closed) return;
      closed = true;
      await processor.close();
      await queue.close();
      await closeRedisClient(connection);
    },
  };
}
