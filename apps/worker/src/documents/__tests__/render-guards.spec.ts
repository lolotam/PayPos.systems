import type { Job } from 'bullmq';
import { documentStatusKey } from '@pospay/contracts';
import { expect, it } from 'vitest';

import { processDocumentJob, recordExternalJobFailure } from '../process-job.ts';
import { renderId, seedQueued, statusOf, useRender, type FakeRenderer } from './render-harness.ts';

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
