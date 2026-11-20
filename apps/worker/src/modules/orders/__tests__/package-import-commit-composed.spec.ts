import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Queue, Worker as BullWorker } from 'bullmq';
import { systemUuidV7 } from '@pospay/ids';
import type { DeliveryOutcome } from '@pospay/db';
import { PACKAGE_IMPORT_COMMIT_QUEUE } from '../jobs/package-import-commit.processor.ts';
import { PACKAGE_IMPORT_RECOVERY_QUEUE } from '../jobs/package-import-recovery.processor.ts';
import { startPackageImportCommitWorker } from '../index.ts';
import { retryDelayMs } from '../../../outbox/retry-policy.ts';
import {
  packageImportCommitComposedFixture,
  type PackageImportCommitComposedFixture,
} from './package-import-commit-composed.fixture.ts';

let f: PackageImportCommitComposedFixture;

beforeAll(async () => {
  f = await packageImportCommitComposedFixture();
});
afterAll(async () => {
  if (f) await f.close();
});

const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

type Worker = ReturnType<typeof startPackageImportCommitWorker>;

function composed(prefix: string, policy?: (attempt: number) => number | null): Worker {
  return startPackageImportCommitWorker(f.db, f.ids, {
    redisUrl,
    clock: f.clock,
    transactionTimeoutMs: 30_000,
    prefix,
    ...(policy === undefined ? {} : { retryDelayMs: policy }),
  });
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

it('registers the sweep before it acknowledges and the job commits the exact money', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-composed-${ids.newId()}`;
  const worker = composed(prefix);
  const recoveryQueue = queueOn(PACKAGE_IMPORT_RECOVERY_QUEUE, prefix);
  const previewId = await f.commitRequested('composed');
  const claimed = f.commitEvent(previewId);
  const next = vi.fn(async (): Promise<DeliveryOutcome> => ({ delivered: true }));
  try {
    await expect(worker.ready()).resolves.toBeUndefined();
    expect(worker.eventTypes).toEqual(['PackageImportCommitRequested']);
    expect(await worker.deliver(claimed, next)).toEqual({ delivered: true });
    const schedulers = await recoveryQueue.getJobSchedulers();
    expect(schedulers.map((entry) => entry.key)).toContain(`package-import-recovery-${f.company}`);
    await vi.waitFor(
      async () => {
        const [status] = await f.owner`SELECT status FROM import_previews WHERE id=${previewId}`;
        expect(status?.['status']).toBe('committed');
      },
      { timeout: 20000 },
    );
    const [sum] = await f.owner`SELECT sum(unit_value)::text AS total,count(*)::int AS slots
      FROM package_session_slots s JOIN package_entitlements e ON e.company_id=s.company_id AND e.id=s.entitlement_id
      WHERE e.import_batch_id=${previewId}`;
    expect(sum).toMatchObject({ total: '10.001', slots: 730 });
    expect(next).not.toHaveBeenCalled();
  } finally {
    await shutdown(worker, [recoveryQueue]);
  }
}, 40000);

it('hands an event of another type to the next consumer', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-composed-other-${ids.newId()}`;
  const worker = composed(prefix);
  const claimed = f.commitEvent(f.ids.newId());
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
  const prefix = `package-import-commit-composed-schedule-${ids.newId()}`;
  const worker = composed(prefix);
  const commitQueue = queueOn(PACKAGE_IMPORT_COMMIT_QUEUE, prefix);
  const previewId = await f.commitRequested('schedule-failed');
  const claimed = f.commitEvent(previewId);
  const next = vi.fn(async (): Promise<DeliveryOutcome> => ({ delivered: true }));
  const reject = vi
    .spyOn(Queue.prototype, 'upsertJobScheduler')
    .mockRejectedValueOnce(new Error('Synthetic redis outage'));
  try {
    await worker.ready();
    const outcome = await worker.deliver(claimed, next);
    expect(outcome).toEqual({
      delivered: false,
      error: 'PACKAGE_IMPORT_RECOVERY_SCHEDULE_RETRY',
      retryInMs: 2000,
    });
    expect(await commitQueue.getJob(claimed.id)).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
    expect(
      (await f.owner`SELECT status FROM import_previews WHERE id=${previewId}`)[0]?.['status'],
    ).toBe('commit_requested');
  } finally {
    reject.mockRestore();
    await shutdown(worker, [commitQueue]);
  }
}, 25000);

it('keeps the retry policy answer when the recovery schedule fails, including park on the last attempt', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-composed-policy-${ids.newId()}`;
  const worker = composed(prefix, retryDelayMs);
  const commitQueue = queueOn(PACKAGE_IMPORT_COMMIT_QUEUE, prefix);
  const previewId = await f.commitRequested('schedule-policy');
  const next = vi.fn(async (): Promise<DeliveryOutcome> => ({ delivered: true }));
  const reject = vi
    .spyOn(Queue.prototype, 'upsertJobScheduler')
    .mockRejectedValue(new Error('Synthetic redis outage'));
  try {
    await worker.ready();
    // العاشرة آخر محاولة في السياسة: null تعني الإيقاف، فلا تتحول إلى إعادة بعد ثانيتين.
    const last = f.commitEvent(previewId, { attempt: 10 });
    expect(await worker.deliver(last, next)).toEqual({
      delivered: false,
      error: 'PACKAGE_IMPORT_RECOVERY_SCHEDULE_RETRY',
      retryInMs: null,
    });
    expect(await commitQueue.getJob(last.id)).toBeUndefined();
    const first = f.commitEvent(previewId, { attempt: 1 });
    expect(await worker.deliver(first, next)).toEqual({
      delivered: false,
      error: 'PACKAGE_IMPORT_RECOVERY_SCHEDULE_RETRY',
      retryInMs: retryDelayMs(1),
    });
    expect(await commitQueue.getJob(first.id)).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  } finally {
    reject.mockRestore();
    await shutdown(worker, [commitQueue]);
  }
}, 25000);

it('force-closes the commit worker before the recovery worker so no new commit starts while it drains', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-composed-close-${ids.newId()}`;
  const worker = composed(prefix);
  const queues = [
    queueOn(PACKAGE_IMPORT_COMMIT_QUEUE, prefix),
    queueOn(PACKAGE_IMPORT_RECOVERY_QUEUE, prefix),
  ];
  const closed: Array<{ queue: string; force: boolean }> = [];
  const originalClose = BullWorker.prototype.close;
  const spy = vi.spyOn(BullWorker.prototype, 'close').mockImplementation(async function (
    this: InstanceType<typeof BullWorker>,
    force?: boolean,
  ) {
    closed.push({ queue: this.name, force: force === true });
    return originalClose.call(this, force);
  });
  try {
    await worker.ready();
    await worker.close();
    expect(closed).toEqual([
      { queue: PACKAGE_IMPORT_COMMIT_QUEUE, force: true },
      { queue: PACKAGE_IMPORT_RECOVERY_QUEUE, force: false },
    ]);
  } finally {
    spy.mockRestore();
    for (const queue of queues) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  }
}, 25000);
