import { expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { systemUuidV7 } from '@pospay/ids';
import type { ClaimedEvent } from '@pospay/db';
import { PACKAGE_SALE_QUEUE, startPackageSaleProcessor } from './package-sale.processor.ts';
import {
  PackageSaleRetryError,
  type ExecutePackageSale,
} from '../use-cases/execute-package-sale/execute-package-sale.ts';

const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

type Ids = ReturnType<typeof systemUuidV7>;

function saleEvent(ids: Ids, overrides: Partial<ClaimedEvent> = {}): ClaimedEvent {
  const requestId = ids.newId();
  return {
    companyId: ids.newId(),
    id: ids.newId(),
    aggregateId: requestId,
    aggregateType: 'package_sale_request',
    eventType: 'PackageSaleRequested',
    payload: { sale_request_id: requestId },
    attempt: 1,
    ...overrides,
  };
}

/** بوابة نفتحها يدويًا؛ بنستخدمها عشان نلحق نقرا حالة الـ job وهو شغّال. */
function gate() {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open: () => open() };
}

async function shutdown(
  processor: { close: () => Promise<void> },
  queue: Queue,
): Promise<void> {
  await processor.close();
  await queue.obliterate({ force: true });
  await queue.close();
}

it('delivers one job for a valid event and drops the duplicate delivery', async () => {
  const ids = systemUuidV7();
  const prefix = `package-sale-test-${ids.newId()}`;
  const paused = gate();
  const execute = vi.fn(async () => {
    await paused.opened;
  });
  const fail = vi.fn(async () => undefined);
  const processor = startPackageSaleProcessor(
    { execute, fail } as unknown as ExecutePackageSale,
    redisUrl,
    prefix,
  );
  const queue = new Queue(PACKAGE_SALE_QUEUE, { connection: { url: redisUrl }, prefix });
  const claimed = saleEvent(ids);
  try {
    await processor.ready();
    expect(await processor.deliver(claimed)).toEqual({ delivered: true });
    expect(await processor.deliver(claimed)).toEqual({ delivered: true });
    const job = await queue.getJob(claimed.id);
    expect(job?.data).toEqual({
      companyId: claimed.companyId,
      saleRequestId: claimed.aggregateId,
    });
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed']);
    expect(jobs).toHaveLength(1);
  } finally {
    paused.open();
    await shutdown(processor, queue);
  }
}, 25000);

it.each(['payload-mismatch', 'wrong-aggregate-type', 'non-uuid'])(
  'parks %s without enqueueing a sale job',
  async (scenario) => {
    const ids = systemUuidV7();
    const prefix = `package-sale-invalid-${ids.newId()}`;
    const processor = startPackageSaleProcessor(
      {
        execute: async () => undefined,
        fail: async () => undefined,
      } as unknown as ExecutePackageSale,
      redisUrl,
      prefix,
    );
    const queue = new Queue(PACKAGE_SALE_QUEUE, { connection: { url: redisUrl }, prefix });
    const requestId = ids.newId();
    const claimed = saleEvent(ids, {
      aggregateType: scenario === 'wrong-aggregate-type' ? 'package_sale' : 'package_sale_request',
      aggregateId: scenario === 'non-uuid' ? 'not-a-uuid' : requestId,
      payload:
        scenario === 'payload-mismatch'
          ? { sale_request_id: ids.newId() }
          : scenario === 'non-uuid'
            ? { sale_request_id: 'not-a-uuid' }
            : { sale_request_id: requestId },
    });
    try {
      await processor.ready();
      expect(await processor.deliver(claimed)).toEqual({
        delivered: false,
        error: 'PACKAGE_SALE_EVENT_INVALID',
        retryInMs: null,
      });
      expect(await queue.getJob(claimed.id)).toBeUndefined();
    } finally {
      await shutdown(processor, queue);
    }
  },
);

it('asks the dispatcher to retry when the queue refuses the job', async () => {
  const ids = systemUuidV7();
  const prefix = `package-sale-queue-down-${ids.newId()}`;
  const processor = startPackageSaleProcessor(
    {
      execute: async () => undefined,
      fail: async () => undefined,
    } as unknown as ExecutePackageSale,
    redisUrl,
    prefix,
  );
  const queue = new Queue(PACKAGE_SALE_QUEUE, { connection: { url: redisUrl }, prefix });
  const claimed = saleEvent(ids);
  try {
    await processor.ready();
    const reject = vi
      .spyOn(Queue.prototype, 'add')
      .mockRejectedValueOnce(new Error('Synthetic queue outage'));
    expect(await processor.deliver(claimed)).toEqual({
      delivered: false,
      error: 'PACKAGE_SALE_QUEUE_RETRY',
      retryInMs: 2000,
    });
    reject.mockRestore();
  } finally {
    await shutdown(processor, queue);
  }
});

it.each([
  ['an unknown error', new Error('Synthetic unknown failure')],
  ['an internal sale retry error', new PackageSaleRetryError()],
])(
  'retries %s three times and then closes the request with PACKAGE_SALE_FAILED',
  async (scenario, failure) => {
    const ids = systemUuidV7();
    const prefix = `package-sale-attempts-${scenario.replaceAll(' ', '-')}-${ids.newId()}`;
    const execute = vi.fn(async () => {
      throw failure;
    });
    const fail = vi.fn(async () => undefined);
    const processor = startPackageSaleProcessor(
      { execute, fail } as unknown as ExecutePackageSale,
      redisUrl,
      prefix,
    );
    const queue = new Queue(PACKAGE_SALE_QUEUE, { connection: { url: redisUrl }, prefix });
    const claimed = saleEvent(ids);
    try {
      await processor.ready();
      expect(await processor.deliver(claimed)).toEqual({ delivered: true });
      await vi.waitFor(
        () =>
          expect(fail).toHaveBeenCalledWith(
            claimed.companyId,
            claimed.aggregateId,
            'PACKAGE_SALE_FAILED',
            undefined,
          ),
        { timeout: 25000 },
      );
      expect(execute).toHaveBeenCalledTimes(3);
      expect(fail).toHaveBeenCalledTimes(1);
    } finally {
      await shutdown(processor, queue);
    }
  },
  40000,
);

it('finalizes a named refusal with its code and details without selling again', async () => {
  const ids = systemUuidV7();
  const prefix = `package-sale-refusal-${ids.newId()}`;
  const execute = vi.fn(async () => {
    throw new PackageSaleRetryError('PACKAGE_SELLER_NOT_ELIGIBLE', { current_revision: 2 });
  });
  const fail = vi.fn(async () => undefined);
  const processor = startPackageSaleProcessor(
    { execute, fail } as unknown as ExecutePackageSale,
    redisUrl,
    prefix,
  );
  const queue = new Queue(PACKAGE_SALE_QUEUE, { connection: { url: redisUrl }, prefix });
  const claimed = saleEvent(ids);
  try {
    await processor.ready();
    expect(await processor.deliver(claimed)).toEqual({ delivered: true });
    await vi.waitFor(
      () =>
        expect(fail).toHaveBeenCalledWith(
          claimed.companyId,
          claimed.aggregateId,
          'PACKAGE_SELLER_NOT_ELIGIBLE',
          { current_revision: 2 },
        ),
      { timeout: 15000 },
    );
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    await shutdown(processor, queue);
  }
}, 25000);

it('keeps the close for a later attempt when the first one fails', async () => {
  const ids = systemUuidV7();
  const prefix = `package-sale-finalize-${ids.newId()}`;
  const execute = vi.fn(async () => {
    throw new PackageSaleRetryError('PACKAGE_SALE_FAILED');
  });
  let closes = 0;
  const fail = vi.fn(async () => {
    closes += 1;
    if (closes === 1) throw new Error('Synthetic database outage');
  });
  const processor = startPackageSaleProcessor(
    { execute, fail } as unknown as ExecutePackageSale,
    redisUrl,
    prefix,
  );
  const queue = new Queue(PACKAGE_SALE_QUEUE, { connection: { url: redisUrl }, prefix });
  const claimed = saleEvent(ids);
  try {
    await processor.ready();
    expect(await processor.deliver(claimed)).toEqual({ delivered: true });
    await vi.waitFor(
      async () => {
        const job = await queue.getJob(claimed.id);
        expect(await job?.getState()).toBe('delayed');
      },
      { timeout: 5000, interval: 20 },
    );
    await vi.waitFor(() => expect(fail).toHaveBeenCalledTimes(2), { timeout: 15000 });
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    await shutdown(processor, queue);
  }
}, 30000);
