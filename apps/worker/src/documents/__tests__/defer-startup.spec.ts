import { DOCUMENT_XLSX_MIME_TYPE } from '@pospay/contracts';
import { DelayedError, type Job } from 'bullmq';
import { expect, it, vi } from 'vitest';

import { deferPdfWhileStarting } from '../defer-pdf.ts';
import { DocumentSourceRegistry } from '../source-registry.ts';
import {
  FakeRenderer,
  closeRender,
  finishJob,
  openRender,
  renderId,
  seedQueued,
  statusOf,
} from './render-harness.ts';

/** متصفح بيقوم ببطء: الطلب اللي في الطابور لازم يتأجل لحد ما يطلع. */
class SlowStartRenderer extends FakeRenderer {
  override async start(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 6_000));
    await super.start();
  }
}

function job(companyId: string, id: string, kind: string) {
  return { company_id: companyId, render_id: id, kind };
}

it('defers a PDF job until the renderer starts', async () => {
  const renderer = new SlowStartRenderer();
  const opened = await openRender({ renderer, awaitStarted: false });
  try {
    const companyId = renderId();
    const id = renderId();
    opened.registry.register('fixture', { load: async () => '<p>ok</p>' });
    await seedQueued(opened, companyId, id);
    const done = finishJob(opened, job(companyId, id, 'fixture'), id);
    await new Promise((resolve) => setTimeout(resolve, 5_500));
    expect((await statusOf(opened, companyId, id))['state']).not.toBe('FAILED');
    expect(renderer.seen).toEqual([]);
    await done;
    expect((await statusOf(opened, companyId, id))['state']).toBe('READY');
    expect(renderer.seen).toEqual(['<p>ok</p>']);
  } finally {
    await closeRender(opened);
  }
}, 30_000);

it('defers only PDF jobs while the renderer starts', async () => {
  const bytesRegistry = new DocumentSourceRegistry({
    fixtureXlsx: { mimeType: DOCUMENT_XLSX_MIME_TYPE },
  });
  bytesRegistry.register('fixtureXlsx', {
    output: 'bytes',
    mimeType: DOCUMENT_XLSX_MIME_TYPE,
    load: async () => new Uint8Array(),
  });
  const bytesDelayed = vi.fn();
  const bytesJob = {
    data: job(renderId(), renderId(), 'fixtureXlsx'),
    moveToDelayed: bytesDelayed,
  } as unknown as Job;
  await deferPdfWhileStarting(bytesJob, 'token', { starting: true }, bytesRegistry);
  expect(bytesDelayed).not.toHaveBeenCalled();

  const pdfRegistry = new DocumentSourceRegistry();
  pdfRegistry.register('fixture', { load: async () => '<p>ok</p>' });
  const pdfDelayed = vi.fn();
  const pdfJob = {
    data: job(renderId(), renderId(), 'fixture'),
    moveToDelayed: pdfDelayed,
  } as unknown as Job;
  await expect(
    deferPdfWhileStarting(pdfJob, 'token', { starting: true }, pdfRegistry),
  ).rejects.toThrow(DelayedError);
  expect(pdfDelayed).toHaveBeenCalledTimes(1);
});
