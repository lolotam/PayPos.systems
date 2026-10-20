import { DocumentTooLargeError } from '@pospay/documents';
import { expect, it } from 'vitest';

import { renderId, seedQueued, statusOf, useRender, type FakeRenderer } from './render-harness.ts';

function job(companyId: string, id: string, kind: string) {
  return { company_id: companyId, render_id: id, kind };
}

it('fails an unknown kind on the first attempt', async () => {
  await useRender(async (opened) => {
    const companyId = renderId();
    const id = renderId();
    let loads = 0;
    let active = 0;
    opened.registry.register('decoy', {
      load: async () => {
        loads += 1;
        return '<p>x</p>';
      },
    });
    opened.events.on('active', () => {
      active += 1;
    });
    await seedQueued(opened, companyId, id);
    const started = Date.now();
    await expect(
      opened.queue
        .add('render', job(companyId, id, 'missing'), {
          jobId: id,
          attempts: 2,
          backoff: { type: 'fixed', delay: 5000 },
          removeOnFail: true,
        })
        .then((added) => added.waitUntilFinished(opened.events)),
    ).rejects.toThrow('DOCUMENT_KIND_UNKNOWN');
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(loads).toBe(0);
    expect(active).toBe(1);
    expect((await statusOf(opened, companyId, id))['state']).toBe('FAILED');
  });
});

it('fails oversized HTML after one source load', async () => {
  await useRender(async (opened) => {
    const renderer = opened.renderer as FakeRenderer;
    const companyId = renderId();
    const id = renderId();
    let loads = 0;
    opened.registry.register('fixture', {
      load: async () => {
        loads += 1;
        return 'x'.repeat(5 * 1024 * 1024);
      },
    });
    await seedQueued(opened, companyId, id);
    const started = Date.now();
    await expect(
      opened.queue
        .add('render', job(companyId, id, 'fixture'), {
          jobId: id,
          attempts: 2,
          backoff: { type: 'fixed', delay: 5000 },
          removeOnFail: true,
        })
        .then((added) => added.waitUntilFinished(opened.events)),
    ).rejects.toThrow('DOCUMENT_TOO_LARGE');
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(loads).toBe(1);
    expect(renderer.seen).toEqual([]);
    expect((await statusOf(opened, companyId, id))['error_code']).toBe('DOCUMENT_TOO_LARGE');
  });
});

it('fails an oversized PDF after one render', async () => {
  await useRender(async (opened) => {
    const renderer = opened.renderer as FakeRenderer;
    const companyId = renderId();
    const id = renderId();
    let loads = 0;
    let renders = 0;
    renderer.render = async (html) => {
      renders += 1;
      renderer.seen.push(html);
      throw new DocumentTooLargeError('pdf');
    };
    opened.registry.register('fixture', {
      load: async () => {
        loads += 1;
        return '<p>ok</p>';
      },
    });
    await seedQueued(opened, companyId, id);
    const started = Date.now();
    await expect(
      opened.queue
        .add('render', job(companyId, id, 'fixture'), {
          jobId: id,
          attempts: 2,
          backoff: { type: 'fixed', delay: 5000 },
          removeOnFail: true,
        })
        .then((added) => added.waitUntilFinished(opened.events)),
    ).rejects.toThrow('DOCUMENT_TOO_LARGE');
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(loads).toBe(1);
    expect(renders).toBe(1);
    expect((await statusOf(opened, companyId, id))['state']).toBe('FAILED');
  });
});
