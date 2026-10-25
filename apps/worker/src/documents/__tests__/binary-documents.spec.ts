import {
  DOCUMENT_BYTES_MAX_BYTES,
  DOCUMENT_PDF_MIME_TYPE,
  DOCUMENT_XLSX_MIME_TYPE,
  documentBytesKey,
} from '@pospay/contracts';
import type { DocumentRenderer } from '@pospay/documents';
import { expect, it } from 'vitest';

import { DocumentSourceRegistry } from '../source-registry.ts';
import {
  closeRender,
  FakeRenderer,
  finishJob,
  openRender,
  renderId,
  seedQueued,
  statusOf,
  useRender,
} from './render-harness.ts';

const BYTES_KIND = 'fixtureXlsx';

function job(companyId: string, id: string, kind: string) {
  return { company_id: companyId, render_id: id, kind };
}

/** خريطة بايتات مستقلة عن خريطة الإنتاج، عشان الاختبار ما يعتمدش على نوع الإنتاج. */
function bytesRegistry(): DocumentSourceRegistry {
  return new DocumentSourceRegistry({ [BYTES_KIND]: { mimeType: DOCUMENT_XLSX_MIME_TYPE } });
}

function bytesSource(bytes: Uint8Array) {
  return {
    output: 'bytes' as const,
    mimeType: DOCUMENT_XLSX_MIME_TYPE,
    load: async () => bytes,
  };
}

it('completes a bytes document while the renderer is unavailable', async () => {
  const renderer = new FakeRenderer();
  renderer.available = false;
  await useRender(
    async (opened) => {
      const companyId = renderId();
      const id = renderId();
      const bytes = Uint8Array.from(Buffer.from('XLSX-BYTES-1'));
      opened.registry.register(BYTES_KIND, bytesSource(bytes));
      await seedQueued(opened, companyId, id);
      await finishJob(opened, job(companyId, id, BYTES_KIND), id);
      expect(renderer.seen).toEqual([]);
      const status = await statusOf(opened, companyId, id);
      expect(status['state']).toBe('READY');
      expect(status['mime_type']).toBe(DOCUMENT_XLSX_MIME_TYPE);
      const stored = await opened.redis.getBuffer(documentBytesKey(companyId, id));
      expect(Buffer.from(stored ?? new Uint8Array()).equals(Buffer.from(bytes))).toBe(true);
    },
    { renderer, registry: bytesRegistry() },
  );
});

it('hands the bytes to one GETDEL and nothing on the next', async () => {
  await useRender(
    async (opened) => {
      const companyId = renderId();
      const id = renderId();
      const key = documentBytesKey(companyId, id);
      opened.registry.register(BYTES_KIND, bytesSource(Uint8Array.from(Buffer.from('XLSX-ONCE'))));
      await seedQueued(opened, companyId, id);
      await finishJob(opened, job(companyId, id, BYTES_KIND), id);
      expect(String(await opened.redis.call('GETDEL', key))).toBe('XLSX-ONCE');
      expect(await opened.redis.call('GETDEL', key)).toBeNull();
    },
    { registry: bytesRegistry() },
  );
});

it('fails an oversized bytes document on the first attempt', async () => {
  await useRender(
    async (opened) => {
      const companyId = renderId();
      const id = renderId();
      let loads = 0;
      opened.registry.register(BYTES_KIND, {
        output: 'bytes',
        mimeType: DOCUMENT_XLSX_MIME_TYPE,
        load: async () => {
          loads += 1;
          return new Uint8Array(DOCUMENT_BYTES_MAX_BYTES + 1);
        },
      });
      await seedQueued(opened, companyId, id);
      const started = Date.now();
      await expect(finishJob(opened, job(companyId, id, BYTES_KIND), id)).rejects.toThrow(
        'DOCUMENT_TOO_LARGE',
      );
      expect(Date.now() - started).toBeLessThan(4_000);
      expect(loads).toBe(1);
      const status = await statusOf(opened, companyId, id);
      expect(status['state']).toBe('FAILED');
      expect(status['error_code']).toBe('DOCUMENT_TOO_LARGE');
    },
    { registry: bytesRegistry() },
  );
});

it('refuses a PDF kind when the renderer is unavailable', async () => {
  const renderer = new FakeRenderer();
  renderer.available = false;
  await useRender(
    async (opened) => {
      const companyId = renderId();
      const id = renderId();
      let loads = 0;
      opened.registry.register('fixture', {
        load: async () => {
          loads += 1;
          return '<p>x</p>';
        },
      });
      await seedQueued(opened, companyId, id);
      await expect(finishJob(opened, job(companyId, id, 'fixture'), id)).rejects.toThrow(
        'DOCUMENT_RENDER_FAILED',
      );
      expect(loads).toBe(0);
      expect(renderer.seen).toEqual([]);
      expect((await statusOf(opened, companyId, id))['state']).not.toBe('READY');
    },
    { renderer, registry: bytesRegistry() },
  );
});

it('renders a PDF kind and records the PDF MIME type', async () => {
  await useRender(
    async (opened) => {
      const renderer = opened.renderer as FakeRenderer;
      const companyId = renderId();
      const id = renderId();
      opened.registry.register('fixture', { load: async () => '<p>ok</p>' });
      await seedQueued(opened, companyId, id);
      await finishJob(opened, job(companyId, id, 'fixture'), id);
      const status = await statusOf(opened, companyId, id);
      expect(status['state']).toBe('READY');
      expect(status['mime_type']).toBe(DOCUMENT_PDF_MIME_TYPE);
      expect(renderer.seen).toEqual(['<p>ok</p>']);
    },
    { registry: bytesRegistry() },
  );
});

it('refuses a source that does not match the bytes-kind map', () => {
  const registry = bytesRegistry();
  expect(() => registry.register('other', bytesSource(new Uint8Array()))).toThrow(/other/);
  expect(() =>
    registry.register(BYTES_KIND, {
      ...bytesSource(new Uint8Array()),
      mimeType: DOCUMENT_PDF_MIME_TYPE,
    }),
  ).toThrow();
  expect(() => registry.register(BYTES_KIND, { load: async () => '<p>x</p>' })).toThrow();
  expect(() => registry.register(BYTES_KIND, bytesSource(new Uint8Array()))).not.toThrow();
});

it('completes a bytes document while the renderer start never settles', async () => {
  const renderer: DocumentRenderer = {
    start: () => new Promise<void>(() => undefined),
    close: async () => undefined,
    isAvailable: () => false,
    onUnavailable: () => undefined,
    onAvailable: () => undefined,
    render: async () => new Uint8Array(),
  };
  const opened = await openRender({ renderer, registry: bytesRegistry(), awaitStarted: false });
  try {
    let settled = false;
    void opened.handle.started.then(() => {
      settled = true;
    });
    const companyId = renderId();
    const id = renderId();
    opened.registry.register(
      BYTES_KIND,
      bytesSource(Uint8Array.from(Buffer.from('XLSX-NO-CHROMIUM'))),
    );
    await seedQueued(opened, companyId, id);
    await finishJob(opened, job(companyId, id, BYTES_KIND), id);
    const status = await statusOf(opened, companyId, id);
    expect(status['state']).toBe('READY');
    expect(status['mime_type']).toBe(DOCUMENT_XLSX_MIME_TYPE);
    expect(settled).toBe(false);
  } finally {
    await closeRender(opened);
  }
});
