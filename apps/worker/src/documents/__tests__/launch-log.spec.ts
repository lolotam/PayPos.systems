import { Writable } from 'node:stream';
import { createLogger } from '@pospay/observability';
import { Redis } from 'ioredis';
import { expect, it } from 'vitest';

import { WORKER_LOG_EVENTS } from '../../shared/log-events.ts';
import { beginDocumentRendering } from '../start-documents.ts';
import { redisUrl } from './render-harness.ts';

async function waitFor(lines: string[], needle: string): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < 4_000) {
    const text = lines.join('\n');
    if (text.includes(needle)) return text;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return lines.join('\n');
}

it('logs the launch error class and strips the browser path', async () => {
  const lines: string[] = [];
  const logger = createLogger('info', {
    events: WORKER_LOG_EVENTS,
    destination: new Writable({
      write(chunk, encoding, done) {
        void encoding;
        lines.push(String(chunk));
        done();
      },
    }),
  });
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  const handle = beginDocumentRendering({
    redis,
    redisUrl,
    logger,
    clock: { now: () => 1 },
    startupMs: 5_000,
    livenessIntervalMs: 60_000,
    browserFactory: {
      launch: () => {
        const error = new Error('missing /opt/pw/chrome');
        error.name = 'LaunchError';
        return Promise.reject(error);
      },
    },
  });
  try {
    const text = await waitFor(lines, '"error_class":"LaunchError"');
    expect(text).toContain('"error_class":"LaunchError"');
    expect(text).toContain('document renderer unavailable');
    expect(text).not.toContain('/opt/pw/chrome');
  } finally {
    await handle.close();
    redis.disconnect();
  }
});
