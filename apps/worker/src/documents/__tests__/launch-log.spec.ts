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

it('logs an allowlisted launch token and drops the browser path', async () => {
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
    const text = await waitFor(lines, '"error_class":"OTHER"');
    expect(text).toContain('"error_class":"OTHER"');
    expect(text).toContain('document renderer unavailable');
    expect(text).not.toContain('LaunchError');
    expect(text).not.toContain('/opt/pw/chrome');
    expect(text).not.toContain('error_message');
  } finally {
    await handle.close();
    redis.disconnect();
  }
});

it('logs neither a person name nor an attendance value', async () => {
  const person = 'Noura Salim';
  const attendance = 'attendance 08:17';
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
        const error = new Error(attendance);
        error.name = person;
        return Promise.reject(error);
      },
    },
  });
  try {
    const text = await waitFor(lines, '"error_class":"OTHER"');
    expect(text).toContain('"error_class":"OTHER"');
    expect(text).not.toContain(person);
    expect(text).not.toContain('Noura');
    expect(text).not.toContain(attendance);
    expect(text).not.toContain('08:17');
    expect(text).not.toContain('error_message');
  } finally {
    await handle.close();
    redis.disconnect();
  }
});
