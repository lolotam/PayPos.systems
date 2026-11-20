import { expect, it, vi } from 'vitest';
import { Job, Queue } from 'bullmq';
import { systemUuidV7 } from '@pospay/ids';
import type { ClaimedEvent } from '@pospay/db';
import {
  PACKAGE_IMPORT_COMMIT_QUEUE,
  startPackageImportCommitProcessor,
} from './package-import-commit.processor.ts';
import { PackageCommitRetryError } from '../use-cases/commit-package-import/commit-package-import.ts';
import { commitUseCaseDouble } from './package-import-commit-use-case.double.ts';
import { retryDelayMs } from '../../../outbox/retry-policy.ts';

const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

type Ids = ReturnType<typeof systemUuidV7>;

function commitEvent(ids: Ids, overrides: Partial<ClaimedEvent> = {}): ClaimedEvent {
  const previewId = ids.newId();
  return {
    companyId: ids.newId(),
    id: ids.newId(),
    aggregateId: previewId,
    aggregateType: 'import_preview',
    eventType: 'PackageImportCommitRequested',
    payload: { preview_id: previewId },
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

async function shutdown(processor: { close: () => Promise<void> }, queue: Queue): Promise<void> {
  await processor.close();
  await queue.obliterate({ force: true });
  await queue.close();
}

it('transports ids only after outbox delivery and drops the duplicate delivery', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-test-${ids.newId()}`;
  const paused = gate();
  const execute = vi.fn(async () => {
    await paused.opened;
  });
  const fail = vi.fn(async () => undefined);
  const processor = startPackageImportCommitProcessor(
    commitUseCaseDouble({ execute, fail }),
    redisUrl,
    { prefix },
  );
  const queue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, { connection: { url: redisUrl }, prefix });
  const claimed = commitEvent(ids);
  try {
    await processor.ready();
    expect(await processor.deliver(claimed)).toEqual({ delivered: true });
    expect(await processor.deliver(claimed)).toEqual({ delivered: true });
    const job = await queue.getJob(claimed.id);
    expect(job?.data).toEqual({ companyId: claimed.companyId, previewId: claimed.aggregateId });
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed']);
    expect(jobs).toHaveLength(1);
  } finally {
    paused.open();
    await shutdown(processor, queue);
  }
}, 25000);

it('retries an unknown failure three times and then closes the request with IMPORT_COMMIT_FAILED', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-attempts-${ids.newId()}`;
  const execute = vi.fn(async () => {
    throw new Error('Synthetic unknown failure');
  });
  const fail = vi.fn(async () => undefined);
  const processor = startPackageImportCommitProcessor(
    commitUseCaseDouble({ execute, fail }),
    redisUrl,
    { prefix },
  );
  const queue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, { connection: { url: redisUrl }, prefix });
  const claimed = commitEvent(ids);
  try {
    await processor.ready();
    expect(await processor.deliver(claimed)).toEqual({ delivered: true });
    await vi.waitFor(
      () =>
        expect(fail).toHaveBeenCalledWith(
          claimed.companyId,
          claimed.aggregateId,
          'IMPORT_COMMIT_FAILED',
        ),
      { timeout: 25000 },
    );
    expect(execute).toHaveBeenCalledTimes(3);
    expect(fail).toHaveBeenCalledTimes(1);
  } finally {
    await shutdown(processor, queue);
  }
}, 45000);

it('finalizes a named refusal with its safe code without a second execute', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-refusal-${ids.newId()}`;
  const execute = vi.fn(async () => {
    throw new PackageCommitRetryError('IMPORT_PREVIEW_EXPIRED');
  });
  const fail = vi.fn(async () => undefined);
  const processor = startPackageImportCommitProcessor(
    commitUseCaseDouble({ execute, fail }),
    redisUrl,
    { prefix },
  );
  const queue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, { connection: { url: redisUrl }, prefix });
  const claimed = commitEvent(ids);
  try {
    await processor.ready();
    expect(await processor.deliver(claimed)).toEqual({ delivered: true });
    await vi.waitFor(
      () =>
        expect(fail).toHaveBeenCalledWith(
          claimed.companyId,
          claimed.aggregateId,
          'IMPORT_PREVIEW_EXPIRED',
        ),
      { timeout: 15000 },
    );
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    await shutdown(processor, queue);
  }
}, 25000);

it('keeps failure persistence durable across a failed finalize without running money again', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-finalize-${ids.newId()}`;
  const execute = vi.fn(async () => {
    throw new PackageCommitRetryError('IMPORT_PREVIEW_EXPIRED');
  });
  let closes = 0;
  const fail = vi.fn(async () => {
    closes += 1;
    if (closes === 1) throw new Error('Synthetic database outage');
  });
  const useCase = commitUseCaseDouble({ execute, fail });
  const processor = startPackageImportCommitProcessor(useCase, redisUrl, { prefix });
  const queue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, { connection: { url: redisUrl }, prefix });
  const claimed = commitEvent(ids);
  try {
    await processor.ready();
    expect(await processor.deliver(claimed)).toEqual({ delivered: true });
    await vi.waitFor(
      async () => {
        const job = await queue.getJob(claimed.id);
        expect(job?.progress).toEqual({
          stage: 'finalizing-commit-failure',
          code: 'IMPORT_PREVIEW_EXPIRED',
        });
        expect(await job?.getState()).toBe('delayed');
      },
      { timeout: 15000 },
    );
    await vi.waitFor(() => expect(fail).toHaveBeenCalledTimes(2), { timeout: 15000 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenLastCalledWith(
      claimed.companyId,
      claimed.aggregateId,
      'IMPORT_PREVIEW_EXPIRED',
    );
  } finally {
    await shutdown(processor, queue);
  }
}, 30000);

it.each(['wrong-aggregate-type', 'mismatched-payload', 'extra-payload-key', 'non-uuid-aggregate'])(
  'parks %s without enqueueing a commit job or touching the database',
  async (scenario) => {
    const ids = systemUuidV7();
    const prefix = `package-import-commit-invalid-${ids.newId()}`;
    const execute = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    const processor = startPackageImportCommitProcessor(
      commitUseCaseDouble({ execute, fail }),
      redisUrl,
      { prefix },
    );
    const queue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, { connection: { url: redisUrl }, prefix });
    const previewId = ids.newId();
    const claimed = commitEvent(ids, {
      aggregateId: scenario === 'non-uuid-aggregate' ? 'not-a-uuid' : previewId,
      aggregateType:
        scenario === 'wrong-aggregate-type' ? 'import_preview_batch' : 'import_preview',
      payload:
        scenario === 'mismatched-payload'
          ? { preview_id: ids.newId() }
          : scenario === 'extra-payload-key'
            ? { preview_id: previewId, phone: '+99912345678' }
            : { preview_id: previewId },
    });
    try {
      await processor.ready();
      expect(await processor.deliver(claimed)).toEqual({
        delivered: false,
        error: 'PACKAGE_IMPORT_COMMIT_EVENT_INVALID',
        retryInMs: null,
      });
      expect(await queue.getJob(claimed.id)).toBeUndefined();
      expect(execute).not.toHaveBeenCalled();
      expect(fail).not.toHaveBeenCalled();
    } finally {
      await shutdown(processor, queue);
    }
  },
);

it('asks the dispatcher for the policy delay when the queue refuses the job', async () => {
  const ids = systemUuidV7();
  const defaultPrefix = `package-import-commit-queue-default-${ids.newId()}`;
  const defaultProcessor = startPackageImportCommitProcessor(
    commitUseCaseDouble({ execute: async () => undefined, fail: async () => undefined }),
    redisUrl,
    { prefix: defaultPrefix },
  );
  const defaultQueue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, {
    connection: { url: redisUrl },
    prefix: defaultPrefix,
  });
  const policyPrefix = `package-import-commit-queue-policy-${ids.newId()}`;
  const policyProcessor = startPackageImportCommitProcessor(
    commitUseCaseDouble({ execute: async () => undefined, fail: async () => undefined }),
    redisUrl,
    { prefix: policyPrefix, retryDelayMs },
  );
  const policyQueue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, {
    connection: { url: redisUrl },
    prefix: policyPrefix,
  });
  const reject = vi
    .spyOn(Queue.prototype, 'add')
    .mockRejectedValueOnce(new Error('Synthetic queue outage'))
    .mockRejectedValueOnce(new Error('Synthetic queue outage'))
    .mockRejectedValueOnce(new Error('Synthetic queue outage'));
  try {
    await Promise.all([defaultProcessor.ready(), policyProcessor.ready()]);
    expect(await defaultProcessor.deliver(commitEvent(ids, { attempt: 2 }))).toEqual({
      delivered: false,
      error: 'PACKAGE_IMPORT_COMMIT_QUEUE_RETRY',
      retryInMs: 2000,
    });
    expect(await policyProcessor.deliver(commitEvent(ids, { attempt: 1 }))).toEqual({
      delivered: false,
      error: 'PACKAGE_IMPORT_COMMIT_QUEUE_RETRY',
      retryInMs: retryDelayMs(1),
    });
    expect(await policyProcessor.deliver(commitEvent(ids, { attempt: 3 }))).toEqual({
      delivered: false,
      error: 'PACKAGE_IMPORT_COMMIT_QUEUE_RETRY',
      retryInMs: retryDelayMs(3),
    });
    expect(retryDelayMs(1)).not.toBe(retryDelayMs(3));
  } finally {
    reject.mockRestore();
    await shutdown(defaultProcessor, defaultQueue);
    await shutdown(policyProcessor, policyQueue);
  }
});

it('re-runs a refusal whose progress write and finalize both threw, and the next outcome stands', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-refusal-rerun-${ids.newId()}`;
  const paused = gate();
  const execute = vi
    .fn(async (): Promise<void> => {
      await paused.opened;
    })
    .mockImplementationOnce(async () => {
      throw new PackageCommitRetryError('IMPORT_PREVIEW_EXPIRED');
    });
  const fail = vi.fn(async () => undefined);
  const processor = startPackageImportCommitProcessor(
    commitUseCaseDouble({ execute, fail }),
    redisUrl,
    { prefix },
  );
  const queue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, { connection: { url: redisUrl }, prefix });
  const claimed = commitEvent(ids);
  const progress = vi
    .spyOn(Job.prototype, 'updateProgress')
    .mockRejectedValue(new Error('Synthetic progress outage'));
  try {
    await processor.ready();
    expect(await processor.deliver(claimed)).toEqual({ delivered: true });
    // الرفض حُسب لكن لا شيء تخزّن: كتابة progress فشلت وfail لم يُستدعَ؛ الجولة التالية تعيد execute وتكون نتيجتها الفيصل.
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2), { timeout: 20000 });
    expect(fail).not.toHaveBeenCalled();
    const active = await queue.getJob(claimed.id);
    expect(await active?.getState()).toBe('active');
    paused.open();
    await vi.waitFor(async () => expect(await queue.getJob(claimed.id)).toBeUndefined(), {
      timeout: 15000,
    });
    expect(fail).not.toHaveBeenCalled();
  } finally {
    paused.open();
    progress.mockRestore();
    await shutdown(processor, queue);
  }
}, 40000);

it('stores no raw error text in Redis when every attempt fails with a marker error', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-marker-${ids.newId()}`;
  const companyId = ids.newId();
  const previewId = ids.newId();
  const marker = 'SYNTHETIC_RAW_ERROR_MARKER-must-not-reach-redis';
  const execute = vi.fn(async (): Promise<void> => {
    throw new Error(marker);
  });
  const fail = vi.fn(async () => undefined);
  const processor = startPackageImportCommitProcessor(
    commitUseCaseDouble({ execute, fail }),
    redisUrl,
    { prefix },
  );
  const queue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, { connection: { url: redisUrl }, prefix });
  try {
    await processor.ready();
    // إضافة مباشرة بلا removeOnComplete لتبقى المهمة للقراءة بعد اكتمال المحاولات الثلاث.
    // معرف المهمة لا يجوز أن يكون marker: هذا اسم مفتاح داخلي في BullMQ يتصادم مع هاش المهمة.
    await queue.add('commit', { companyId, previewId }, { jobId: 'raw-error-final', attempts: 3 });
    await vi.waitFor(
      () => expect(fail).toHaveBeenCalledWith(companyId, previewId, 'IMPORT_COMMIT_FAILED'),
      { timeout: 25000 },
    );
    expect(execute).toHaveBeenCalledTimes(3);
    const job = await queue.getJob('raw-error-final');
    expect(await job?.getState()).toBe('completed');
    expect(job?.failedReason ?? '').not.toContain(marker);
    expect((job?.stacktrace ?? []).join('\n')).not.toContain(marker);
  } finally {
    await shutdown(processor, queue);
  }
}, 45000);
