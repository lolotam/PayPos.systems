import { afterEach, expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import type { ClaimedEvent } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { readPgTestEnv } from '../../../../../../../packages/db/test/pg-env.ts';

import {
  RatingClaimsFailedError,
  type DueRatingCursor,
} from '../../use-cases/claim-rating-requests/claim-rating-requests.ts';
import {
  RATING_CLAIMS_QUEUE,
  startRatingClaimsProcessor,
  type RatingClaimDetector,
} from '../rating-claims.processor.ts';

const companyId = '01920000-0000-7000-8000-0000000000b2';
const continuation: DueRatingCursor = {
  dueAt: new Date('2026-06-01T14:00:00.000Z'),
  id: '01920000-0000-7000-8000-0000000000c3',
};
const continuationData = {
  companyId,
  after: { dueAt: continuation.dueAt.toISOString(), id: continuation.id },
};
const event: ClaimedEvent = {
  companyId,
  id: '01920000-0000-7000-8000-0000000000d4',
  aggregateType: 'service_session',
  aggregateId: '01920000-0000-7000-8000-0000000000e5',
  eventType: 'ServiceSessionRecorded',
  payload: {},
  attempt: 1,
};

let processor: ReturnType<typeof startRatingClaimsProcessor> | undefined;
let queue: Queue | undefined;
let prefix = '';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function open(detector: RatingClaimDetector) {
  readPgTestEnv();
  const redisUrl =
    process.env['REDIS_URL'] ??
    `redis://:${encodeURIComponent(process.env['REDIS_PASSWORD'] ?? '')}@127.0.0.1:6379`;
  prefix = `rating-claims-processor-test-${systemUuidV7().newId()}`;
  processor = startRatingClaimsProcessor(detector, redisUrl, prefix);
  queue = new Queue(RATING_CLAIMS_QUEUE, { connection: { url: redisUrl }, prefix });
  await processor.ready();
}

async function trigger(): Promise<void> {
  if (processor === undefined) throw new Error('PROCESSOR_NOT_STARTED');
  expect(await processor.deliver(event, async () => ({ delivered: true }))).toEqual({
    delivered: true,
  });
}

afterEach(async () => {
  await processor?.close();
  if (queue !== undefined) {
    await queue.removeJobScheduler(`${RATING_CLAIMS_QUEUE}-${companyId}`).catch(() => undefined);
    await queue.obliterate({ force: true });
    await queue.close();
  }
  queue = undefined;
  processor = undefined;
  vi.restoreAllMocks();
});

it('a trigger racing a running claim cannot restore the old continuation', async () => {
  const started = gate();
  const finish = gate();
  const staleUpsert = gate();
  const allowStaleUpsert = gate();
  const advancedUpsert = gate();
  const detector: RatingClaimDetector = {
    execute: vi.fn(async () => {
      started.release();
      await finish.promise;
      return continuation;
    }),
  };
  await open(detector);
  try {
    await trigger();
    await started.promise;

    const originalUpsert = Queue.prototype.upsertJobScheduler;
    vi.spyOn(Queue.prototype, 'upsertJobScheduler').mockImplementation(async function (
      this: Queue,
      schedulerId,
      repeatOptions,
      template,
    ) {
      const data = template?.data as { after?: { id: string } } | undefined;
      if (data?.after === undefined) {
        staleUpsert.release();
        await allowStaleUpsert.promise;
      }
      const scheduled = await originalUpsert.call(this, schedulerId, repeatOptions, template);
      if (data?.after?.id === continuation.id) advancedUpsert.release();
      return scheduled;
    });

    const racingTrigger = trigger();
    await Promise.race([racingTrigger, staleUpsert.promise]);
    finish.release();
    await advancedUpsert.promise;
    allowStaleUpsert.release();
    await racingTrigger;

    const schedule = await queue?.getJobScheduler(`${RATING_CLAIMS_QUEUE}-${companyId}`);
    expect(schedule?.template?.data).toEqual(continuationData);
  } finally {
    finish.release();
    allowStaleUpsert.release();
  }
});

it('a per-request failure advances the cursor used by the real BullMQ retry', async () => {
  const seen: (DueRatingCursor | null)[] = [];
  const detector: RatingClaimDetector = {
    execute: vi.fn(async (_company, after) => {
      seen.push(after);
      if (seen.length === 1) throw new RatingClaimsFailedError(1, continuation);
      return null;
    }),
  };
  await open(detector);
  await trigger();

  await vi.waitFor(
    () => {
      expect(seen).toHaveLength(2);
    },
    { timeout: 10_000, interval: 50 },
  );
  expect(seen).toEqual([null, continuation]);
  await vi.waitFor(async () => {
    const schedule = await queue?.getJobScheduler(`${RATING_CLAIMS_QUEUE}-${companyId}`);
    expect(schedule?.template?.data).toEqual({ companyId });
  });
});
