import { expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { systemUuidV7 } from '@pospay/ids';
import {
  PACKAGE_SALE_RECOVERY_QUEUE,
  startPackageSaleRecoveryProcessor,
} from './package-sale-recovery.processor.ts';
import type { RecoverPackageSales } from '../use-cases/recover-package-sales/recover-package-sales.ts';

const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

async function shutdown(
  processor: { close: () => Promise<void> },
  queue: Queue,
): Promise<void> {
  await processor.close();
  await queue.obliterate({ force: true });
  await queue.close();
}

it('registers one repeatable sweep for the company on a one minute interval', async () => {
  const ids = systemUuidV7();
  const prefix = `package-sale-recovery-test-${ids.newId()}`;
  const companyId = ids.newId();
  const processor = startPackageSaleRecoveryProcessor(
    { execute: async () => undefined } as unknown as RecoverPackageSales,
    redisUrl,
    prefix,
  );
  const queue = new Queue(PACKAGE_SALE_RECOVERY_QUEUE, { connection: { url: redisUrl }, prefix });
  try {
    await processor.ready();
    await processor.register(companyId);
    const schedulers = await queue.getJobSchedulers();
    const scheduler = schedulers.find((entry) => entry.key === `package-sale-recovery-${companyId}`);
    expect(scheduler).toBeDefined();
    expect(scheduler?.every).toBe(60_000);
    expect(scheduler?.template?.data).toEqual({ companyId });
  } finally {
    await shutdown(processor, queue);
  }
}, 25000);

it('keeps one scheduler when the same company registers twice', async () => {
  const ids = systemUuidV7();
  const prefix = `package-sale-recovery-twice-${ids.newId()}`;
  const companyId = ids.newId();
  const processor = startPackageSaleRecoveryProcessor(
    { execute: async () => undefined } as unknown as RecoverPackageSales,
    redisUrl,
    prefix,
  );
  const queue = new Queue(PACKAGE_SALE_RECOVERY_QUEUE, { connection: { url: redisUrl }, prefix });
  try {
    await processor.ready();
    await processor.register(companyId);
    await processor.register(companyId);
    const schedulers = await queue.getJobSchedulers();
    expect(
      schedulers.filter((entry) => entry.key === `package-sale-recovery-${companyId}`),
    ).toHaveLength(1);
  } finally {
    await shutdown(processor, queue);
  }
}, 25000);

it('rejects the registration when the scheduler cannot be written', async () => {
  const ids = systemUuidV7();
  const prefix = `package-sale-recovery-refused-${ids.newId()}`;
  const processor = startPackageSaleRecoveryProcessor(
    { execute: async () => undefined } as unknown as RecoverPackageSales,
    redisUrl,
    prefix,
  );
  const queue = new Queue(PACKAGE_SALE_RECOVERY_QUEUE, { connection: { url: redisUrl }, prefix });
  try {
    await processor.ready();
    const reject = vi
      .spyOn(Queue.prototype, 'upsertJobScheduler')
      .mockRejectedValueOnce(new Error('Synthetic redis outage'));
    await expect(processor.register(ids.newId())).rejects.toThrow('Synthetic redis outage');
    reject.mockRestore();
  } finally {
    await shutdown(processor, queue);
  }
}, 25000);

it('runs the sweep for the company in the scheduled job', async () => {
  const ids = systemUuidV7();
  const prefix = `package-sale-recovery-job-${ids.newId()}`;
  const companyId = ids.newId();
  const execute = vi.fn(async () => undefined);
  const processor = startPackageSaleRecoveryProcessor(
    { execute } as unknown as RecoverPackageSales,
    redisUrl,
    prefix,
  );
  const queue = new Queue(PACKAGE_SALE_RECOVERY_QUEUE, { connection: { url: redisUrl }, prefix });
  try {
    await processor.ready();
    await processor.register(companyId);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledWith(companyId), { timeout: 15000 });
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    await shutdown(processor, queue);
  }
}, 25000);
