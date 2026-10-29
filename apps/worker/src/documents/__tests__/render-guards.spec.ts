import { Writable } from 'node:stream';
import { UnrecoverableError, type Job } from 'bullmq';
import { documentBytesKey, documentStatusKey, DOCUMENT_XLSX_MIME_TYPE } from '@pospay/contracts';
import type { Redis } from 'ioredis';
import { createLogger } from '@pospay/observability';
import { expect, it } from 'vitest';

import { CommissionStatementUnavailableError } from '../commission-statement-unavailable-error.ts';
import { processDocumentJob, recordExternalJobFailure } from '../process-job.ts';
import { DocumentSourceRegistry } from '../source-registry.ts';
import { storeReady } from '../status-store.ts';
import { AttendanceStatementEmptyError } from '../statement-empty-error.ts';
import { WORKER_LOG_EVENTS } from '../../shared/log-events.ts';
import { FakeRenderer, renderId, seedQueued, statusOf, useRender } from './render-harness.ts';

function job(companyId: string, id: string, kind: string) {
  return { company_id: companyId, render_id: id, kind };
}

function asJob(
  data: unknown,
  fields: { attemptsMade?: number; finishedOn?: number; processedOn?: number },
): Job {
  return {
    data,
    attemptsMade: fields.attemptsMade ?? 0,
    opts: { attempts: 2 },
    ...(fields.finishedOn === undefined ? {} : { finishedOn: fields.finishedOn }),
    ...(fields.processedOn === undefined ? {} : { processedOn: fields.processedOn }),
  } as Job;
}

it('times out a hanging source load inside the job deadline', async () => {
  await useRender(async (opened) => {
    const renderer = opened.renderer as FakeRenderer;
    const companyId = renderId();
    const id = renderId();
    let signal: AbortSignal | undefined;
    opened.registry.register('fixture', {
      load: (_companyId, _renderId, passed) => {
        signal = passed;
        return new Promise(() => undefined);
      },
    });
    await seedQueued(opened, companyId, id);
    const started = Date.now();
    await expect(
      processDocumentJob(asJob(job(companyId, id, 'fixture'), { attemptsMade: 1 }), {
        redis: opened.redis,
        registry: opened.registry,
        renderer,
        clock: { now: () => started },
        logger: opened.logger,
        deadlineMs: 40,
      }),
    ).rejects.toThrow('DOCUMENT_RENDER_TIMEOUT');
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
    expect(renderer.seen).toEqual([]);
    expect((await statusOf(opened, companyId, id))['error_code']).toBe('DOCUMENT_RENDER_TIMEOUT');
  });
});

it('marks a job failed outside the processor when BullMQ finishes it', async () => {
  await useRender(async (opened) => {
    const companyId = renderId();
    const id = renderId();
    const data = job(companyId, id, 'fixture');
    await opened.redis.hset(documentStatusKey(companyId, id), {
      state: 'RENDERING',
      requested_by: 'user-1',
      filename: 'a.pdf',
    });
    const deps = { redis: opened.redis, logger: opened.logger, clock: { now: () => 25 } };
    await recordExternalJobFailure(
      asJob(data, { finishedOn: 20, processedOn: 5, attemptsMade: 2 }),
      deps,
    );
    const status = await statusOf(opened, companyId, id);
    expect(status['state']).toBe('FAILED');
    expect(status['error_code']).toBe('DOCUMENT_RENDER_FAILED');
    expect(status['requested_by']).toBe('user-1');
    expect(opened.lines.join('\n')).toContain('"state":"FAILED"');
    await opened.redis.hset(documentStatusKey(companyId, id), { state: 'RENDERING' });
    const before = opened.lines.length;
    await recordExternalJobFailure(asJob(data, { attemptsMade: 2 }), deps);
    expect((await statusOf(opened, companyId, id))['state']).toBe('RENDERING');
    expect(opened.lines.length).toBe(before);
  });
});

function quietLogger() {
  return createLogger('info', {
    events: WORKER_LOG_EVENTS,
    destination: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  });
}

it('releases the job when status Redis never answers', async () => {
  const redis = { eval: () => new Promise(() => undefined) } as unknown as Redis;
  const started = Date.now();
  await expect(
    processDocumentJob(asJob(job(renderId(), renderId(), 'fixture'), { attemptsMade: 1 }), {
      redis,
      registry: new DocumentSourceRegistry(),
      renderer: new FakeRenderer(),
      clock: { now: () => started },
      logger: quietLogger(),
      deadlineMs: 40,
    }),
  ).rejects.toThrow('DOCUMENT_RENDER_TIMEOUT');
  expect(Date.now() - started).toBeLessThan(2_500);
});

it('does not start a rejecting source when the deadline has already passed', async () => {
  const reasons: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    reasons.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    await useRender(async (opened) => {
      const companyId = renderId();
      const id = renderId();
      let calls = 0;
      opened.registry.register('fixture', {
        load: () => {
          calls += 1;
          // وقت مستحيل عمداً حتى لا يحتويه طابع وقت الـ logger فيفشل الاختبار في دقيقة بعينها
          return Promise.reject(new Error('Noura Salim attendance 27:93'));
        },
      });
      await seedQueued(opened, companyId, id);
      await expect(
        processDocumentJob(asJob(job(companyId, id, 'fixture'), { attemptsMade: 1 }), {
          redis: opened.redis,
          registry: opened.registry,
          renderer: opened.renderer,
          clock: { now: () => Date.now() },
          logger: opened.logger,
          deadlineMs: 0,
        }),
      ).rejects.toThrow('DOCUMENT_RENDER_TIMEOUT');
      expect(calls).toBe(0);
      expect(opened.lines.join('\n')).not.toContain('Noura Salim');
      expect(opened.lines.join('\n')).not.toContain('27:93');
      await new Promise((resolve) => setImmediate(resolve));
    });
    expect(reasons).toEqual([]);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

it('does not store READY after the deadline', async () => {
  await useRender(async (opened) => {
    const companyId = renderId();
    const lateId = renderId();
    const openId = renderId();
    const pdf = Uint8Array.from(Buffer.from('%PDF-1'));
    await opened.redis.hset(documentStatusKey(companyId, lateId), { state: 'RENDERING' });
    await opened.redis.hset(documentStatusKey(companyId, openId), { state: 'RENDERING' });
    expect(await storeReady(opened.redis, companyId, lateId, pdf, Date.now() - 60_000)).toBe(
      'late',
    );
    expect((await statusOf(opened, companyId, lateId))['state']).toBe('RENDERING');
    expect(await opened.redis.exists(documentBytesKey(companyId, lateId))).toBe(0);
    expect(await storeReady(opened.redis, companyId, openId, pdf, Date.now() + 60_000)).toBe(
      'stored',
    );
    expect((await statusOf(opened, companyId, openId))['state']).toBe('READY');
  });
});

it('ends an empty statement as a final failure with no retry and no PDF', async () => {
  await useRender(async (opened) => {
    const companyId = renderId();
    const id = renderId();
    let loads = 0;
    opened.registry.register('attendance-statement', {
      load: async () => {
        loads += 1;
        throw new AttendanceStatementEmptyError();
      },
    });
    await seedQueued(opened, companyId, id);
    const started = Date.now();
    const failure = await processDocumentJob(
      asJob(job(companyId, id, 'attendance-statement'), { attemptsMade: 0 }),
      {
        redis: opened.redis,
        registry: opened.registry,
        renderer: opened.renderer,
        clock: { now: () => started },
        logger: opened.logger,
      },
    ).catch((error: unknown) => error);
    // الخطأ غير قابل لإعادة المحاولة، فBullMQ مش هيعيد الوظيفة.
    expect(failure).toBeInstanceOf(UnrecoverableError);
    expect((failure as Error).message).toBe('STATEMENT_EMPTY');
    expect(loads).toBe(1);
    const status = await statusOf(opened, companyId, id);
    expect(status['state']).toBe('FAILED');
    expect(status['error_code']).toBe('STATEMENT_EMPTY');
    expect(await opened.redis.exists(documentBytesKey(companyId, id))).toBe(0);
  });
});

it.each(['REQUEST_MISSING', 'PAYMENT_DATA_UNAVAILABLE'] as const)(
  'ends a commission statement without its data (%s) as a final failure with no retry and no file',
  async (reason) => {
    await useRender(async (opened) => {
      const companyId = renderId();
      const id = renderId();
      let loads = 0;
      opened.registry.register('commission-statement-xlsx', {
        output: 'bytes',
        mimeType: DOCUMENT_XLSX_MIME_TYPE,
        load: async () => {
          loads += 1;
          throw new CommissionStatementUnavailableError(reason);
        },
      });
      await seedQueued(opened, companyId, id);
      const started = Date.now();
      const failure = await processDocumentJob(
        asJob(job(companyId, id, 'commission-statement-xlsx'), { attemptsMade: 0 }),
        {
          redis: opened.redis,
          registry: opened.registry,
          renderer: opened.renderer,
          clock: { now: () => started },
          logger: opened.logger,
        },
      ).catch((error: unknown) => error);
      // الفشل دائم، فBullMQ مش هيعيد الوظيفة.
      expect(failure).toBeInstanceOf(UnrecoverableError);
      expect((failure as Error).message).toBe('STATEMENT_EMPTY');
      expect(loads).toBe(1);
      const status = await statusOf(opened, companyId, id);
      expect(status['state']).toBe('FAILED');
      expect(status['error_code']).toBe('STATEMENT_EMPTY');
      expect(await opened.redis.exists(documentBytesKey(companyId, id))).toBe(0);
    });
  },
);

it('maps any other source failure to DOCUMENT_RENDER_FAILED', async () => {
  await useRender(async (opened) => {
    const companyId = renderId();
    const id = renderId();
    opened.registry.register('attendance-statement', {
      load: async () => {
        throw new Error('boom');
      },
    });
    await seedQueued(opened, companyId, id);
    const started = Date.now();
    await expect(
      processDocumentJob(asJob(job(companyId, id, 'attendance-statement'), { attemptsMade: 1 }), {
        redis: opened.redis,
        registry: opened.registry,
        renderer: opened.renderer,
        clock: { now: () => started },
        logger: opened.logger,
      }),
    ).rejects.toThrow('DOCUMENT_RENDER_FAILED');
    const status = await statusOf(opened, companyId, id);
    expect(status['state']).toBe('FAILED');
    expect(status['error_code']).toBe('DOCUMENT_RENDER_FAILED');
    expect(await opened.redis.exists(documentBytesKey(companyId, id))).toBe(0);
  });
});
