import { expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { systemUuidV7 } from '@pospay/ids';
import type { ClaimedEvent } from '@pospay/db';
import {
  SERVICE_IMPORT_QUEUE,
  startServiceImportProcessor,
} from './service-import-commit.processor.ts';
import type { CommitServiceImport } from '../use-cases/commit-service-import/commit-service-import.ts';

// FR-009: محاولة أولى وثلاث إعادات، ثم فشل تثبيت شرطي؛ والنشر بعد claim بمعرّف وظيفة ثابت (ADR-0018).

const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

it(
  'transports ids only, retries three times after the first attempt, then fails conditionally',
  { timeout: 90_000 },
  async () => {
  const ids = systemUuidV7();
  const prefix = `service-import-test-${ids.newId()}`;
  const execute = vi.fn(async () => {
    throw new Error('Synthetic retry');
  });
  const fail = vi.fn(async () => undefined);
  const processor = startServiceImportProcessor(
    { execute, fail } as unknown as CommitServiceImport,
    redisUrl,
    prefix,
  );
  const queue = new Queue(SERVICE_IMPORT_QUEUE, { connection: { url: redisUrl }, prefix });
  const previewId = ids.newId();
  const event: ClaimedEvent = {
    companyId: ids.newId(),
    id: ids.newId(),
    aggregateId: previewId,
    aggregateType: 'import_preview',
    eventType: 'ServiceImportCommitRequested',
    payload: { preview_id: previewId },
    attempt: 1,
  };
  try {
    await processor.ready();
    expect(await processor.deliver(event)).toEqual({ delivered: true });
    const job = await queue.getJob(event.id);
    expect(job?.data).toEqual({ companyId: event.companyId, previewId });
    await vi.waitFor(() => expect(fail).toHaveBeenCalledWith(event.companyId, previewId), {
      timeout: 60_000,
    });
    expect(execute).toHaveBeenCalledTimes(4);
    // الفشل النهائي يدخل مجموعة الفاشل في BullMQ (لا «مكتمل» ولا حذف) فتراه مقاييس الفشل.
    await vi.waitFor(async () => expect(await queue.getJobState(event.id)).toBe('failed'), {
      timeout: 10_000,
    });
    expect(fail).toHaveBeenCalledTimes(1);
    const reject = vi
      .spyOn(Queue.prototype, 'add')
      .mockRejectedValueOnce(new Error('Synthetic unavailable'));
    expect(await processor.deliver(event)).toEqual({
      delivered: false,
      error: 'SERVICE_IMPORT_QUEUE_RETRY',
      retryInMs: 2000,
    });
    reject.mockRestore();
  } finally {
    await processor.close();
    await queue.close();
  }
});

  it(
    'refuses an event payload that breaks the strict contract without retrying it',
    { timeout: 60_000 },
    async () => {
      const ids = systemUuidV7();
      const prefix = `service-import-payload-${ids.newId()}`;
      const execute = vi.fn(async () => undefined);
      const fail = vi.fn(async () => undefined);
      const processor = startServiceImportProcessor(
        { execute, fail } as unknown as CommitServiceImport,
        redisUrl,
        prefix,
      );
      try {
        await processor.ready();
        const base = {
          companyId: ids.newId(),
          id: ids.newId(),
          aggregateId: ids.newId(),
          aggregateType: 'import_preview',
          eventType: 'ServiceImportCommitRequested',
          attempt: 1,
        };
        expect(
          await processor.deliver({ ...base, payload: { preview_id: ids.newId(), extra: 'x' } }),
        ).toEqual({
          delivered: false,
          error: 'SERVICE_IMPORT_COMMIT_EVENT_INVALID',
          retryInMs: null,
        });
        expect(await processor.deliver({ ...base, payload: {} })).toEqual({
          delivered: false,
          error: 'SERVICE_IMPORT_COMMIT_EVENT_INVALID',
          retryInMs: null,
        });
        // الحمولة السليمة التي تشير لمعاينة غير صف الطلب نفسه تُرفض كذلك: الطلب في outbox هو الهوية.
        expect(
          await processor.deliver({ ...base, payload: { preview_id: ids.newId() } }),
        ).toEqual({
          delivered: false,
          error: 'SERVICE_IMPORT_COMMIT_EVENT_INVALID',
          retryInMs: null,
        });
        expect(execute).not.toHaveBeenCalled();
        expect(fail).not.toHaveBeenCalled();
      } finally {
        await processor.close();
      }
    },
  );

// إعادة التسليم بعد النجاح تحفظ النتيجة الأصلية دون إدخال ثانٍ: موثّقة في مواصفة الالتزام
// (service-import-commit.spec.ts) وعلى دلالة jobId الثابت نفسها التي يعتمدها موظف الموظفين.
