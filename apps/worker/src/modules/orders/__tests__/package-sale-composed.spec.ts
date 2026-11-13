import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { systemUuidV7 } from '@pospay/ids';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import { PACKAGE_SALE_QUEUE } from '../jobs/package-sale.processor.ts';
import { PACKAGE_SALE_RECOVERY_QUEUE } from '../jobs/package-sale-recovery.processor.ts';
import { startPackageSaleWorker } from '../index.ts';
import { packageSaleFixture, type PackageSaleFixture } from './package-sale.fixture.ts';

let f: PackageSaleFixture;

beforeAll(async () => {
  f = await packageSaleFixture();
});
afterAll(async () => {
  if (f) await f.close();
});

const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

type Worker = ReturnType<typeof startPackageSaleWorker>;

function composed(prefix: string): Worker {
  return startPackageSaleWorker(f.database, f.ids, {
    redisUrl,
    clock: f.clock,
    transactionTimeoutMs: 30_000,
    prefix,
  });
}

function saleEvent(ids: ReturnType<typeof systemUuidV7>, requestId: string): ClaimedEvent {
  return {
    companyId: f.company,
    id: ids.newId(),
    aggregateId: requestId,
    aggregateType: 'package_sale_request',
    eventType: 'PackageSaleRequested',
    payload: { sale_request_id: requestId },
    attempt: 1,
  };
}

function queueOn(name: string, prefix: string): Queue {
  return new Queue(name, { connection: { url: redisUrl }, prefix });
}

async function shutdown(worker: Worker, queues: readonly Queue[]): Promise<void> {
  await worker.close();
  for (const queue of queues) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
}

it('registers the recovery sweep before it acknowledges the delivery and sells the package', async () => {
  const ids = systemUuidV7();
  const prefix = `package-sale-composed-${ids.newId()}`;
  const worker = composed(prefix);
  const recoveryQueue = queueOn(PACKAGE_SALE_RECOVERY_QUEUE, prefix);
  const type = await f.seedType({
    price: '25.000',
    validityDays: 90,
    components: [{ sessions: 10, price: '3.000' }],
  });
  const requestId = await f.request({ type });
  const claimed = saleEvent(ids, requestId);
  const next = vi.fn(async (): Promise<DeliveryOutcome> => ({ delivered: true }));
  try {
    await expect(worker.ready()).resolves.toBeUndefined();
    expect(worker.eventTypes).toEqual(['PackageSaleRequested']);
    expect(await worker.deliver(claimed, next)).toEqual({ delivered: true });
    const schedulers = await recoveryQueue.getJobSchedulers();
    expect(schedulers.map((entry) => entry.key)).toContain(
      `package-sale-recovery-${f.company}`,
    );
    await vi.waitFor(async () => expect((await f.state(requestId)).status).toBe('completed'), {
      timeout: 15000,
    });
    const sold = await f.sold(requestId);
    expect(sold.entitlements).toHaveLength(1);
    expect(sold.slots).toHaveLength(10);
    expect(next).not.toHaveBeenCalled();
  } finally {
    await shutdown(worker, [recoveryQueue]);
  }
}, 30000);

it('hands an event of another type to the next consumer', async () => {
  const ids = systemUuidV7();
  const prefix = `package-sale-composed-other-${ids.newId()}`;
  const worker = composed(prefix);
  const claimed = saleEvent(ids, ids.newId());
  const next = vi.fn(async (): Promise<DeliveryOutcome> => ({ delivered: true }));
  try {
    await worker.ready();
    const outcome = await worker.deliver({ ...claimed, eventType: 'ServiceLineChanged' }, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ delivered: true });
  } finally {
    await shutdown(worker, []);
  }
}, 25000);

it('asks for a retry and enqueues nothing when the recovery schedule fails', async () => {
  const ids = systemUuidV7();
  const prefix = `package-sale-composed-schedule-${ids.newId()}`;
  const worker = composed(prefix);
  const saleQueue = queueOn(PACKAGE_SALE_QUEUE, prefix);
  const claimed = saleEvent(ids, ids.newId());
  const next = vi.fn(async (): Promise<DeliveryOutcome> => ({ delivered: true }));
  try {
    await worker.ready();
    const reject = vi
      .spyOn(Queue.prototype, 'upsertJobScheduler')
      .mockRejectedValueOnce(new Error('Synthetic redis outage'));
    const outcome = await worker.deliver(claimed, next);
    reject.mockRestore();
    expect(outcome).toEqual({
      delivered: false,
      error: 'PACKAGE_SALE_RECOVERY_SCHEDULE_RETRY',
      retryInMs: 2000,
    });
    expect(await saleQueue.getJob(claimed.id)).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  } finally {
    await shutdown(worker, [saleQueue]);
  }
}, 25000);
