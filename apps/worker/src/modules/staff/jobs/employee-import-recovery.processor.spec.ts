import { Queue } from 'bullmq';
import { expect, it, vi } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import type { ClaimedEvent } from '@pospay/db';
import {
  EMPLOYEE_IMPORT_RECOVERY_QUEUE,
  startEmployeeImportRecoveryProcessor,
} from './employee-import-recovery.processor.ts';
import type { RecoverEmployeeImports } from '../use-cases/recover-employee-imports/recover-employee-imports.ts';

const ids = systemUuidV7();
const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

it('registers an id-only tenant schedule before publishing and retries scheduling failures without acknowledgement', async () => {
  const prefix = `employee-import-recovery-test-${ids.newId()}`;
  const execute = vi.fn(async () => undefined);
  const processor = startEmployeeImportRecoveryProcessor(
    { execute } as unknown as RecoverEmployeeImports,
    redisUrl,
    prefix,
  );
  const queue = new Queue(EMPLOYEE_IMPORT_RECOVERY_QUEUE, {
    connection: { url: redisUrl },
    prefix,
  });
  const event: ClaimedEvent = {
    companyId: ids.newId(),
    id: ids.newId(),
    aggregateId: ids.newId(),
    aggregateType: 'import_preview',
    eventType: 'EmployeeImportCommitRequested',
    payload: { preview_id: ids.newId() },
    attempt: 1,
  };
  const next = vi.fn(async () => ({ delivered: true as const }));
  try {
    await processor.ready();
    vi.spyOn(Queue.prototype, 'upsertJobScheduler').mockRejectedValueOnce(
      new Error('Synthetic schedule failure'),
    );
    expect(await processor.deliver(event, next)).toMatchObject({
      delivered: false,
      error: 'EMPLOYEE_IMPORT_RECOVERY_SCHEDULE_RETRY',
    });
    expect(next).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    await processor.deliver(event, next);
    await processor.deliver(event, next);
    expect(next).toHaveBeenCalledTimes(2);
    const schedules = await queue.getJobSchedulers();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.every).toBe(60 * 1000);
    expect(schedules[0]?.template?.data).toEqual({ companyId: event.companyId });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledWith(event.companyId), {
      timeout: 10000,
    });
  } finally {
    vi.restoreAllMocks();
    await processor.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
});
