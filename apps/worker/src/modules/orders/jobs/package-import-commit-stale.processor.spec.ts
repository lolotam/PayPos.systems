import { expect, it, vi } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { Queue } from 'bullmq';
import { systemUuidV7 } from '@pospay/ids';
import {
  PACKAGE_IMPORT_COMMIT_QUEUE,
  startPackageImportCommitProcessor,
} from './package-import-commit.processor.ts';
import { commitUseCaseDouble } from './package-import-commit-use-case.double.ts';

// نافذة العشر دقائق؛ jobs لا يصل domain، والقاعدة نفسها يثبتها اختبار domain.
const PACKAGE_IMPORT_COMMIT_STALE_MS = 10 * 60 * 1000;

const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

async function shutdown(processor: { close: () => Promise<void> }, queue: Queue): Promise<void> {
  await processor.close();
  await queue.obliterate({ force: true });
  await queue.close();
}

it('finalizes with the generic code when an unknown error lands past the stale window', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-stale-error-${ids.newId()}`;
  const companyId = ids.newId();
  const previewId = ids.newId();
  // الساعة المحقونة تقرر موقع النافذة: المهمة بدأت قبل إغلاقها بـ1500 مللي ثانية، ولا شيء يعتمد على سرعة المشغّل.
  const base = Date.now();
  let nowMs = base;
  const execute = vi.fn(async (): Promise<void> => {
    nowMs += 2000;
    throw new Error('Synthetic failure after the stale window');
  });
  const fail = vi.fn(async () => undefined);
  const processor = startPackageImportCommitProcessor(
    commitUseCaseDouble({ execute, fail }),
    redisUrl,
    { prefix, now: () => nowMs },
  );
  const queue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, { connection: { url: redisUrl }, prefix });
  try {
    await processor.ready();
    // المهمة دخلت قبل النافذة والخطأ وقع بعدها: تنفيذ مالي واحد، لا إعادة، وفشل بالرمز العام.
    await queue.add(
      'commit',
      { companyId, previewId },
      {
        jobId: 'stale-mid',
        attempts: 3,
        timestamp: base - (PACKAGE_IMPORT_COMMIT_STALE_MS - 1500),
      },
    );
    await vi.waitFor(
      () => expect(fail).toHaveBeenCalledWith(companyId, previewId, 'IMPORT_COMMIT_FAILED'),
      { timeout: 15000 },
    );
    expect(execute).toHaveBeenCalledTimes(1);
    const job = await queue.getJob('stale-mid');
    expect(await job?.getState()).toBe('completed');
    // مهلة تتجاوز أول backoff تثبت عدم وجود إعادة مجدولة بعد المحاولة الأولى.
    await delay(4000);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledTimes(1);
  } finally {
    await shutdown(processor, queue);
  }
}, 30000);

it('completes a job already past the stale window at entry, on the injected clock, without touching money', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-stale-before-${ids.newId()}`;
  const companyId = ids.newId();
  const previewId = ids.newId();
  // الساعة المحقونة تثبت أن القرار لحظة الدخول لا عند الوقت الحقيقي لجدولة الاختبار.
  const base = Date.now();
  const execute = vi.fn(async (): Promise<void> => undefined);
  const fail = vi.fn(async () => undefined);
  const processor = startPackageImportCommitProcessor(
    commitUseCaseDouble({ execute, fail }),
    redisUrl,
    { prefix, now: () => base },
  );
  const queue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, { connection: { url: redisUrl }, prefix });
  try {
    await processor.ready();
    await queue.add(
      'commit',
      { companyId, previewId },
      {
        jobId: 'stale-before',
        attempts: 3,
        timestamp: base - PACKAGE_IMPORT_COMMIT_STALE_MS - 60_000,
      },
    );
    await vi.waitFor(
      async () => {
        const job = await queue.getJob('stale-before');
        expect(await job?.getState()).toBe('completed');
      },
      { timeout: 15000 },
    );
    expect(execute).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  } finally {
    await shutdown(processor, queue);
  }
}, 30000);

it('finalizes with the generic code when the injected clock crosses the window inside execute', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-stale-cross-${ids.newId()}`;
  const companyId = ids.newId();
  const previewId = ids.newId();
  let nowMs = Date.now();
  const execute = vi.fn(async (): Promise<void> => {
    // الساعة تتقدم داخل المعاملة؛ قرار إعادة المحاولة يُحسب لحظتها فيجد النافذة انتهت.
    nowMs += PACKAGE_IMPORT_COMMIT_STALE_MS + 1000;
    throw new Error('Synthetic unknown failure');
  });
  const fail = vi.fn(async () => undefined);
  const processor = startPackageImportCommitProcessor(
    commitUseCaseDouble({ execute, fail }),
    redisUrl,
    { prefix, now: () => nowMs },
  );
  const queue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, { connection: { url: redisUrl }, prefix });
  try {
    await processor.ready();
    await queue.add(
      'commit',
      { companyId, previewId },
      {
        jobId: 'stale-cross',
        attempts: 3,
        timestamp: nowMs,
      },
    );
    await vi.waitFor(
      () => expect(fail).toHaveBeenCalledWith(companyId, previewId, 'IMPORT_COMMIT_FAILED'),
      { timeout: 15000 },
    );
    expect(execute).toHaveBeenCalledTimes(1);
    const job = await queue.getJob('stale-cross');
    expect(await job?.getState()).toBe('completed');
    // مهلة تتجاوز أول backoff تثبت عدم وجود إعادة مجدولة بعد النافذة.
    await delay(4000);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledTimes(1);
  } finally {
    await shutdown(processor, queue);
  }
}, 30000);

it('re-runs a handler that outlived its lock; the rerun money safety is the status guard proven in the sweep spec', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-stall-${ids.newId()}`;
  const companyId = ids.newId();
  const previewId = ids.newId();
  // أمان المحاولة الثانية ماليًا ليس دليل هذا الاختبار: حارس status في loadPreview هو من يمنع التأثير المزدوج.
  const execute = vi
    .fn(async (): Promise<void> => undefined)
    .mockImplementationOnce(() => new Promise<void>(() => undefined));
  const fail = vi.fn(async () => undefined);
  const useCase = commitUseCaseDouble({ execute, fail });
  const options = { prefix, lockDurationMs: 400, stalledIntervalMs: 200 } as const;
  const processor = startPackageImportCommitProcessor(useCase, redisUrl, options);
  const queue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, { connection: { url: redisUrl }, prefix });
  let second: ReturnType<typeof startPackageImportCommitProcessor> | undefined;
  let firstClosed = false;
  try {
    await processor.ready();
    await queue.add('commit', { companyId, previewId }, { jobId: 'stall-rerun', attempts: 3 });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1), { timeout: 15000 });
    await processor.close(true);
    firstClosed = true;
    second = startPackageImportCommitProcessor(useCase, redisUrl, options);
    await second.ready();
    // معرف المهمة لا يجوز أن يكون stalled: هذا اسم مفتاح حالة في BullMQ يتصادم مع هاش المهمة فيعطّل كاشف العالق.
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2), { timeout: 20000 });
  } finally {
    if (!firstClosed) await processor.close(true);
    await second?.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  }
}, 45000);

it('renews the lock across more than one renewal cycle so a slow handler runs execute exactly once', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-renew-${ids.newId()}`;
  const companyId = ids.newId();
  const previewId = ids.newId();
  const execute = vi.fn(async (): Promise<void> => {
    await delay(2600);
  });
  const fail = vi.fn(async () => undefined);
  const options = { prefix, lockDurationMs: 1000, stalledIntervalMs: 500 } as const;
  const processor = startPackageImportCommitProcessor(
    commitUseCaseDouble({ execute, fail }),
    redisUrl,
    options,
  );
  const queue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, { connection: { url: redisUrl }, prefix });
  try {
    await processor.ready();
    await queue.add('commit', { companyId, previewId }, { jobId: 'renewed', attempts: 3 });
    await vi.waitFor(
      async () => {
        const job = await queue.getJob('renewed');
        expect(await job?.getState()).toBe('completed');
      },
      { timeout: 20000 },
    );
    // الفاحص يكمل دورات كاملة أثناء الانتظار؛ لو انقطع التجديد لعُدّت المهمة عالقة وأُعيد تشغيلها.
    await delay(1500);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
  } finally {
    await shutdown(processor, queue);
  }
}, 45000);
