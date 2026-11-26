// أدوات تسجيل فشل مجدول طلبات التقييم: لقط السجل الحقيقي، وأسرار اصطناعية، وطابور مهمة.
import { Writable } from 'node:stream';

import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger, type Logger } from '@pospay/observability';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import {
  RATING_CLAIMS_QUEUE,
  startRatingClaimsProcessor,
  type RatingClaimsTurnPort,
} from '../../modules/customers/jobs/rating-claims.processor.ts';
import { WORKER_LOG_EVENTS } from '../../shared/log-events.ts';

export const PHONE = '+96550009999';
export const TOKEN = 'tok_secret_99887766';
export const PASSWORD = 'supersecret';
export const REDIS_CREDENTIALS = `redis://:${PASSWORD}@127.0.0.1:56382`;
export const RAW = 'RAW_RATING_PAYLOAD_7c1d9a';

export const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

const ids = systemUuidV7();

/** لقط السجل الحقيقي: سطور JSON كما كتبها pino، مش نداءات دالة وهمية. */
export interface CapturedLog {
  readonly logger: Logger;
  readonly logs: () => string;
  readonly lines: () => Record<string, unknown>[];
}

/** بيلفّ pino بسجل يكتب في ذاكرة، عشان الاختبار يفحص اللي اتكتب فعلاً. */
export function capture(): CapturedLog {
  const state = { logs: '' };
  const sink = new Writable({
    write(chunk, _encoding, done) {
      state.logs += String(chunk);
      done();
    },
  });
  const logger = createLogger('info', { destination: sink, events: WORKER_LOG_EVENTS });
  const lines = () =>
    state.logs
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, logs: () => state.logs, lines };
}

/** دور خدمة بيشتغل وبيخلص عادي؛ التسجيل هو اللي بيتعطّل في الاختبار. */
export const noopTurn = () => ({
  execute: async () => ({
    settlements: {
      TERMINAL: 0,
      ABSENT: 0,
      FUTURE_UNATTEMPTED: 0,
      RETRY: 0,
      DELEGATED: 0,
    },
    forwardVisits: 0,
    retryVisits: 0,
    end: 'COMPLETED' as const,
  }),
});

/** حدث زيارة بمعرّف attempt معيّن، زي اللي المرسّل بيمسكه. */
export function triggerEvent(attempt = 1): ClaimedEvent {
  return {
    companyId: '01920000-0000-7000-8000-0000000000b2',
    id: ids.newId(),
    aggregateType: 'service_session',
    aggregateId: ids.newId(),
    eventType: 'ServiceSessionRecorded',
    payload: {},
    attempt,
  };
}

/** خطأ حامل للأسرار في كل حقل ممكن، زي أخطاء postgres.js الحقيقية. */
export function secretBearingError(): Error {
  return Object.assign(
    new Error(`SYNTHETIC_UPPER_ID_FAILURE ${PHONE} ${TOKEN} ${REDIS_CREDENTIALS} ${RAW}`),
    {
      name: 'PostgresError',
      detail: `Failing row contains (..., {"phone": "${PHONE}", "token": "${TOKEN}"})`,
      where: `JSON data: ${RAW}`,
      parameters: [PHONE, TOKEN, RAW],
      query: `select ... where payload = '${RAW}'`,
      cause: new Error(`${PHONE} ${TOKEN} ${REDIS_CREDENTIALS}`),
    },
  );
}

/** طابور مهمة حقيقي بنفس بادئة المعالج، عشان المهمة تتقرأ من العامل. */
export interface JobHarness {
  readonly prefix: string;
  readonly queue: Queue;
  readonly connection: Redis;
  readonly processor: ReturnType<typeof startRatingClaimsProcessor>;
  close(): Promise<void>;
}

/**
 * بافتح معالج وطابور على Redis حقيقي بنفس البادئة.
 *
 * @param logger سجل العامل اللي بياخد أخطاء الطابور
 * @param turn دور الخدمة اللي بيرمي عند التنفيذ
 * @param url رابط Redis، والافتراضي هو اللي في البيئة
 * @returns الطابور والمعالج ودالة الإغلاق
 */
export function jobHarness(
  logger: Logger,
  turn: RatingClaimsTurnPort,
  url: string = redisUrl,
): JobHarness {
  const prefix = `pospay-test-rating-claims-${ids.newId()}`;
  const processor = startRatingClaimsProcessor({ redisUrl: url, prefix, turn, logger });
  const connection = new Redis(url);
  const queue = new Queue(RATING_CLAIMS_QUEUE, { connection, prefix });
  return {
    prefix,
    queue,
    connection,
    processor,
    close: async () => {
      // منفذ ميت: أوامر BullMQ على اتصال مش متصل بتفضل مستنية، فالإغلاق بيتحد بوقت أقصى.
      await Promise.race([
        (async () => {
          await processor.close();
          await queue.obliterate({ force: true });
          await queue.close();
          await connection.quit();
        })().catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
      connection.disconnect();
    },
  };
}

export const next = async (): Promise<DeliveryOutcome> => ({ delivered: true });
