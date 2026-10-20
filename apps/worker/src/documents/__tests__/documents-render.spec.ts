import { inflateRawSync, inflateSync } from 'node:zlib';
import {
  DOCUMENT_BYTES_TTL_SECONDS,
  DOCUMENT_PDF_MAX_BYTES,
  DOCUMENT_RENDERER_ALIVE_KEY,
  DOCUMENT_STATUS_TTL_SECONDS,
  documentBytesKey,
  documentRenderJobOptions,
  documentStatusKey,
} from '@pospay/contracts';
import {
  DocumentRenderTimeoutError,
  PlaywrightDocumentRenderer,
  fixtureDocument,
  type RendererOptions,
} from '@pospay/documents';
import { expect, it } from 'vitest';

import { DocumentKindUnknownError } from '../kind-error.ts';
import { probeChromium } from './chromium-gate.ts';
import {
  closeRender,
  finishJob,
  openRender,
  renderId,
  seedQueued,
  statusOf,
  useRender,
  type FakeRenderer,
} from './render-harness.ts';

const SECRET = 'SECRET_HTML_9f3a';
const PDF_MARK = 'PDFBYTES_9f3a';

function job(companyId: string, id: string, kind: string) {
  return { company_id: companyId, render_id: id, kind };
}

const chromiumReady = await probeChromium();

it('stores one PDF, keeps API fields, and logs no document body', async () => {
  await useRender(async (opened) => {
    const renderer = opened.renderer as FakeRenderer;
    renderer.pdf = Uint8Array.from(Buffer.from(`%PDF-${PDF_MARK}`));
    const companyId = renderId();
    const id = renderId();
    opened.registry.register('fixture', { load: async () => `<p>${SECRET}</p>` });
    await opened.redis.hset(documentStatusKey(companyId, id), {
      state: 'QUEUED',
      requested_by: 'user-1',
      filename: 'a.pdf',
    });
    const result = await finishJob(opened, job(companyId, id, 'fixture'), id);
    expect(result ?? null).toBeNull();
    const status = await statusOf(opened, companyId, id);
    expect(status['state']).toBe('READY');
    expect(status['requested_by']).toBe('user-1');
    expect(status['filename']).toBe('a.pdf');
    expect(status['error_code']).toBeUndefined();
    const bytes = await opened.redis.getBuffer(documentBytesKey(companyId, id));
    expect(bytes?.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(await opened.redis.ttl(documentBytesKey(companyId, id))).toBeLessThanOrEqual(
      DOCUMENT_BYTES_TTL_SECONDS,
    );
    expect(await opened.redis.ttl(documentStatusKey(companyId, id))).toBeLessThanOrEqual(
      DOCUMENT_STATUS_TTL_SECONDS,
    );
    const logs = opened.lines.join('\n');
    expect(logs).not.toContain(SECRET);
    expect(logs).not.toContain(PDF_MARK);
    expect(logs).toContain('"state":"READY"');
  });
});

it('writes FAILED only on the final attempt', async () => {
  await useRender(async (opened) => {
    const renderer = opened.renderer as FakeRenderer;
    const companyId = renderId();
    const id = renderId();
    let calls = 0;
    renderer.render = async (html) => {
      calls += 1;
      renderer.seen.push(html);
      if (calls === 1) {
        expect(await opened.redis.hget(documentStatusKey(companyId, id), 'error_code')).toBeNull();
        throw new Error('boom');
      }
      return renderer.pdf;
    };
    opened.registry.register('fixture', { load: async () => '<p>ok</p>' });
    await seedQueued(opened, companyId, id);
    await finishJob(opened, job(companyId, id, 'fixture'), id);
    expect(calls).toBe(2);
    expect((await statusOf(opened, companyId, id))['state']).toBe('READY');
  });
});

it('fails an unknown kind without storing bytes', async () => {
  await useRender(async (opened) => {
    const companyId = renderId();
    const id = renderId();
    await seedQueued(opened, companyId, id);
    await expect(finishJob(opened, job(companyId, id, 'missing'), id)).rejects.toThrow(
      'DOCUMENT_KIND_UNKNOWN',
    );
    expect((await statusOf(opened, companyId, id))['error_code']).toBe('DOCUMENT_KIND_UNKNOWN');
    expect(await opened.redis.exists(documentBytesKey(companyId, id))).toBe(0);
    expect(new DocumentKindUnknownError().code).toBe('DOCUMENT_KIND_UNKNOWN');
  });
});

it('drops an invalid payload before Redis or the renderer', async () => {
  await useRender(async (opened) => {
    const renderer = opened.renderer as FakeRenderer;
    const id = renderId();
    await expect(
      finishJob(opened, { company_id: 'nope', render_id: id, kind: 'fixture' }, id),
    ).rejects.toThrow('DOCUMENT_JOB_INVALID');
    expect(renderer.seen).toEqual([]);
    expect(await opened.redis.exists(documentStatusKey('nope', id))).toBe(0);
  });
});

it('rejects oversized HTML without rendering', async () => {
  await useRender(async (opened) => {
    const renderer = opened.renderer as FakeRenderer;
    const companyId = renderId();
    const id = renderId();
    opened.registry.register('fixture', { load: async () => 'x'.repeat(5 * 1024 * 1024) });
    await seedQueued(opened, companyId, id);
    await expect(finishJob(opened, job(companyId, id, 'fixture'), id)).rejects.toThrow(
      'DOCUMENT_TOO_LARGE',
    );
    expect(renderer.seen).toEqual([]);
    expect(await opened.redis.exists(documentBytesKey(companyId, id))).toBe(0);
    expect((await statusOf(opened, companyId, id))['error_code']).toBe('DOCUMENT_TOO_LARGE');
  });
});

it('maps a renderer timeout', async () => {
  await useRender(async (opened) => {
    const renderer = opened.renderer as FakeRenderer;
    renderer.failWith = new DocumentRenderTimeoutError();
    const companyId = renderId();
    const id = renderId();
    opened.registry.register('fixture', { load: async () => `<p>${SECRET}</p>` });
    await seedQueued(opened, companyId, id);
    await expect(finishJob(opened, job(companyId, id, 'fixture'), id)).rejects.toThrow(
      'DOCUMENT_RENDER_TIMEOUT',
    );
    expect((await statusOf(opened, companyId, id))['error_code']).toBe('DOCUMENT_RENDER_TIMEOUT');
    expect(opened.lines.join('\n')).not.toContain(SECRET);
  });
});

it('does not overwrite bytes already stored', async () => {
  await useRender(async (opened) => {
    const companyId = renderId();
    const id = renderId();
    const key = documentBytesKey(companyId, id);
    await seedQueued(opened, companyId, id);
    await opened.redis.set(key, 'KEEP', 'EX', 30);
    opened.registry.register('fixture', { load: async () => '<p>ok</p>' });
    await finishJob(opened, job(companyId, id, 'fixture'), id);
    expect(await opened.redis.get(key)).toBe('KEEP');
    expect((await statusOf(opened, companyId, id))['state']).toBe('READY');
  });
});

it('publishes the liveness key while the renderer is up and deletes it on close', async () => {
  const opened = await openRender({ intervalMs: 200 });
  try {
    expect(await opened.redis.get(DOCUMENT_RENDERER_ALIVE_KEY)).toBe('1');
    const ttl = await opened.redis.ttl(DOCUMENT_RENDERER_ALIVE_KEY);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3);
  } finally {
    await closeRender(opened);
  }
  const redis = opened.redis.duplicate();
  try {
    if (redis.status !== 'ready') {
      await new Promise<void>((resolve, reject) => {
        redis.once('ready', () => resolve());
        redis.once('end', () => reject(new Error('redis ended')));
      });
    }
    expect(await redis.get(DOCUMENT_RENDERER_ALIVE_KEY)).toBeNull();
  } finally {
    redis.disconnect();
  }
});

function embeddedFamily(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  const parts = [raw];
  const marked = /\/Length\s+(\d+)[\s\S]*?stream\r?\n/g;
  for (const match of raw.matchAll(marked)) {
    const length = Number(match[1]);
    const start = (match.index ?? 0) + match[0].length;
    const data = Buffer.from(raw.slice(start, start + length), 'latin1');
    for (const slice of [data, data.subarray(2)]) {
      for (const decode of [inflateSync, inflateRawSync]) {
        try {
          parts.push(decode(slice).toString('latin1'));
        } catch {
          // not a flate stream
        }
      }
    }
  }
  const latin = parts.join('\n');
  const even = latin.length - (latin.length % 2);
  const buffer = Buffer.from(latin.slice(0, even), 'latin1');
  return `${buffer.toString('utf16le')}\n${Buffer.from(buffer).swap16().toString('utf16le')}`;
}

function droppingFactory(): NonNullable<RendererOptions['factory']> {
  let launches = 0;
  return {
    launch: async () => {
      launches += 1;
      const generation = launches;
      const listeners: Array<() => void> = [];
      return {
        on: (_event, listener) => listeners.push(listener),
        close: async () => undefined,
        newContext: async () => ({
          route: async () => undefined,
          close: async () => undefined,
          newPage: async () => ({
            setContent: async () => undefined,
            evaluate: async () => undefined,
            close: async () => undefined,
            pdf: async () => {
              if (generation === 1) {
                for (const listener of listeners) listener();
                await new Promise((resolve) => setTimeout(resolve, 40));
                throw new Error('disconnected');
              }
              return Uint8Array.from(Buffer.from('%PDF-1.4'));
            },
          }),
        }),
      };
    },
  };
}

it('does not publish a second PDF after READY bytes were downloaded', async () => {
  await useRender(async (opened) => {
    const renderer = opened.renderer as FakeRenderer;
    const companyId = renderId();
    const id = renderId();
    const key = documentBytesKey(companyId, id);
    await opened.redis.hset(documentStatusKey(companyId, id), {
      state: 'READY',
      requested_by: 'user-1',
      filename: 'a.pdf',
    });
    await opened.redis.set(key, Buffer.from('%PDF-OLD'), 'EX', 30);
    await opened.redis.call('GETDEL', key);
    opened.registry.register('fixture', { load: async () => '<p>again</p>' });
    await finishJob(opened, job(companyId, id, 'fixture'), id);
    expect(renderer.seen).toEqual([]);
    expect(await opened.redis.exists(key)).toBe(0);
    expect((await statusOf(opened, companyId, id))['state']).toBe('READY');
    expect(opened.lines.join('\n')).toContain('"state":"SKIPPED"');
  });
});

it('does not render when the status key is missing', async () => {
  await useRender(async (opened) => {
    const renderer = opened.renderer as FakeRenderer;
    const companyId = renderId();
    const id = renderId();
    opened.registry.register('fixture', { load: async () => '<p>missing</p>' });
    await finishJob(opened, job(companyId, id, 'fixture'), id);
    expect(renderer.seen).toEqual([]);
    expect(await opened.redis.exists(documentBytesKey(companyId, id))).toBe(0);
    expect(await opened.redis.exists(documentStatusKey(companyId, id))).toBe(0);
    expect(opened.lines.join('\n')).toContain('"state":"SKIPPED"');
  });
});

it('AC-08 retries once the renderer relaunches after a disconnect', async () => {
  const renderer = new PlaywrightDocumentRenderer({
    factory: droppingFactory(),
    browserCloseGraceMs: 0,
  });
  await useRender(
    async (opened) => {
      const companyId = renderId();
      const id = renderId();
      expect(documentRenderJobOptions(id).backoff).toEqual({ type: 'fixed', delay: 5000 });
      opened.registry.register('fixture', { load: async () => '<p>again</p>' });
      await seedQueued(opened, companyId, id);
      await finishJob(opened, job(companyId, id, 'fixture'), id);
      const bytes = await opened.redis.getBuffer(documentBytesKey(companyId, id));
      expect(bytes?.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect((await statusOf(opened, companyId, id))['state']).toBe('READY');
    },
    { renderer },
  );
}, 15_000);

it.skipIf(!chromiumReady)(
  'AC-01 renders a fixture source through the real browser',
  async () => {
    const renderer = new PlaywrightDocumentRenderer();
    await useRender(
      async (opened) => {
        const companyId = renderId();
        const id = renderId();
        opened.registry.register('fixture', {
          load: async () => fixtureDocument({ language: 'ar', lines: ['worker-e2e'] }),
        });
        await seedQueued(opened, companyId, id);
        await finishJob(opened, job(companyId, id, 'fixture'), id);
        const bytes = await opened.redis.getBuffer(documentBytesKey(companyId, id));
        expect(bytes?.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        expect(bytes?.byteLength ?? 0).toBeLessThanOrEqual(DOCUMENT_PDF_MAX_BYTES);
        expect(embeddedFamily(bytes ?? new Uint8Array())).toMatch(
          /IBMPlexSansArabic|IBM Plex Sans Arabic/,
        );
        expect((await statusOf(opened, companyId, id))['state']).toBe('READY');
      },
      { renderer },
    );
  },
  60_000,
);

it('AC-03 rejects an extra key and a missing kind', async () => {
  await useRender(async (opened) => {
    const renderer = opened.renderer as FakeRenderer;
    const companyId = renderId();
    const id = renderId();
    await expect(
      finishJob(opened, { ...job(companyId, id, 'fixture'), note: 'nope' }, id),
    ).rejects.toThrow('DOCUMENT_JOB_INVALID');
    const other = renderId();
    await expect(
      finishJob(opened, { company_id: companyId, render_id: other }, other),
    ).rejects.toThrow('DOCUMENT_JOB_INVALID');
    expect(renderer.seen).toEqual([]);
  });
});

it('AC-07 hands the PDF to one GETDEL and nothing on the next', async () => {
  await useRender(async (opened) => {
    const companyId = renderId();
    const id = renderId();
    const key = documentBytesKey(companyId, id);
    opened.registry.register('fixture', { load: async () => '<p>once</p>' });
    await seedQueued(opened, companyId, id);
    await finishJob(opened, job(companyId, id, 'fixture'), id);
    const ttl = await opened.redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(DOCUMENT_BYTES_TTL_SECONDS);
    const first = await opened.redis.call('GETDEL', key);
    expect(String(first).startsWith('%PDF-')).toBe(true);
    expect(await opened.redis.call('GETDEL', key)).toBeNull();
  });
});
