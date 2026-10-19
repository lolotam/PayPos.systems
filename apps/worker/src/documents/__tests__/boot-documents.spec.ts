import { Writable } from 'node:stream';
import type { Redis } from 'ioredis';
import type { DocumentRenderer } from '@pospay/documents';
import { createLogger } from '@pospay/observability';
import { expect, it } from 'vitest';

import { WORKER_LOG_EVENTS } from '../../shared/log-events.ts';
import { beginDocumentRendering, startCoreBeforeDocuments } from '../start-documents.ts';
import { redisUrl } from './render-harness.ts';

function hungRenderer(release: { go: () => void }, flags: { launched: boolean; closed: boolean }): DocumentRenderer {
  return {
    start: () =>
      new Promise<void>((resolve) => {
        release.go = () => {
          flags.launched = true;
          resolve();
        };
      }),
    close: async () => {
      flags.closed = true;
    },
    isAvailable: () => false,
    onUnavailable: () => undefined,
    onAvailable: () => undefined,
    render: async () => new Uint8Array(),
  };
}

it('finishes core startup while the renderer launch is still pending', async () => {
  const flags = { launched: false, closed: false };
  const release = { go: () => undefined };
  const logger = createLogger('info', {
    events: WORKER_LOG_EVENTS,
    destination: new Writable({
      write(chunk, encoding, done) {
        void chunk;
        void encoding;
        done();
      },
    }),
  });
  let coreStarted = false;
  const handle = await startCoreBeforeDocuments({
    startCore: async () => {
      coreStarted = true;
    },
    beginDocuments: () =>
      beginDocumentRendering({
        redis: {} as Redis,
        redisUrl,
        logger,
        clock: { now: () => 1 },
        renderer: hungRenderer(release, flags),
        startupMs: 30_000,
      }),
    isStopping: () => false,
  });
  expect(coreStarted).toBe(true);
  expect(flags.launched).toBe(false);
  await handle.close();
  expect(flags.closed).toBe(true);
  expect(flags.launched).toBe(false);
  release.go();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(flags.launched).toBe(true);
}, 3_000);
