import { expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { systemUuidV7 } from '@pospay/ids';
import {
  SERVICE_IMPORT_RECOVERY_QUEUE,
  startServiceImportRecoveryProcessor,
} from './service-import-recovery.processor.ts';
import type { RecoverServiceImports } from '../use-cases/recover-service-imports/recover-service-imports.ts';

const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

async function shutdown(processor: { close: () => Promise<void> }, queue: Queue): Promise<void> {
  await processor.close();
  await queue.obliterate({ force: true });
  await queue.close();
}

it('registers one per-minute sweep scheduler for the company across repeated events', async () => {
  const ids = systemUuidV7();
  const prefix = `service-import-recovery-test-${ids.newId()}`;
  const companyId = ids.newId();
  const processor = startServiceImportRecoveryProcessor(
    { execute: async () => undefined } as unknown as RecoverServiceImports,
    redisUrl,
    prefix,
  );
  const queue = new Queue(SERVICE_IMPORT_RECOVERY_QUEUE, {
    connection: { url: redisUrl },
    prefix,
  });
  try {
    await processor.ready();
    await processor.register(companyId);
    await processor.register(companyId);
    const schedulers = await queue.getJobSchedulers();
    const matches = schedulers.filter(
      (entry) => entry.key === `service-import-recovery-${companyId}`,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.every).toBe(60_000);
    expect(matches[0]?.template?.data).toEqual({ companyId });
  } finally {
    await shutdown(processor, queue);
  }
}, 25000);

it('runs the sweep for the company in the scheduled job', async () => {
  const ids = systemUuidV7();
  const prefix = `service-import-recovery-job-${ids.newId()}`;
  const companyId = ids.newId();
  const execute = vi.fn(async () => undefined);
  const processor = startServiceImportRecoveryProcessor(
    { execute } as unknown as RecoverServiceImports,
    redisUrl,
    prefix,
  );
  const queue = new Queue(SERVICE_IMPORT_RECOVERY_QUEUE, {
    connection: { url: redisUrl },
    prefix,
  });
  try {
    await processor.ready();
    await processor.register(companyId);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledWith(companyId), { timeout: 15000 });
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    await shutdown(processor, queue);
  }
}, 25000);

it('stores no raw error text in Redis when the sweep throws a marker error', async () => {
  const ids = systemUuidV7();
  const prefix = `service-import-recovery-marker-${ids.newId()}`;
  const companyId = ids.newId();
  const marker = 'SYNTHETIC_RAW_ERROR_MARKER-must-not-reach-redis';
  const execute = vi.fn(async (): Promise<void> => {
    throw new Error(marker);
  });
  const processor = startServiceImportRecoveryProcessor(
    { execute } as unknown as RecoverServiceImports,
    redisUrl,
    prefix,
  );
  const queue = new Queue(SERVICE_IMPORT_RECOVERY_QUEUE, {
    connection: { url: redisUrl },
    prefix,
  });
  try {
    await processor.ready();
    await queue.add('recover', { companyId }, { jobId: 'raw-error-final', attempts: 1 });
    await vi.waitFor(
      async () => expect(await (await queue.getJob('raw-error-final'))?.getState()).toBe('failed'),
      { timeout: 15000 },
    );
    const job = await queue.getJob('raw-error-final');
    expect(execute).toHaveBeenCalledWith(companyId);
    expect(job?.failedReason).toBe('SERVICE_IMPORT_RECOVERY_RETRY');
    expect((job?.stacktrace ?? []).join('\n')).not.toContain(marker);
  } finally {
    await shutdown(processor, queue);
  }
}, 25000);
