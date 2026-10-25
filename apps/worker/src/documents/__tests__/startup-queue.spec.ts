import net from 'node:net';
import { Writable } from 'node:stream';
import { createLogger } from '@pospay/observability';
import type { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { expect, it } from 'vitest';

import { WORKER_LOG_EVENTS } from '../../shared/log-events.ts';
import { beginDocumentRendering, type DocumentRendering } from '../start-documents.ts';
import { FakeRenderer, redisUrl, whenRedisReady } from './render-harness.ts';

interface SeenQueue {
  worker: Worker;
  connection: Redis;
}

function isClosed(worker: Worker): boolean {
  return (worker as unknown as { closed: boolean }).closed === true;
}

function hangRedis(): Promise<{ url: string; stop: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('hang redis has no port'));
        return;
      }
      resolve({
        url: `redis://127.0.0.1:${String(address.port)}`,
        stop: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

async function until(ready: () => boolean): Promise<void> {
  const started = Date.now();
  while (!ready()) {
    if (Date.now() - started > 12_000) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

it('closes the first queue when Redis never becomes ready', async () => {
  const hang = await hangRedis();
  const seen: SeenQueue[] = [];
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  let handle: DocumentRendering | undefined;
  try {
    await whenRedisReady(redis);
    handle = beginDocumentRendering({
      redis,
      redisUrl: hang.url,
      logger: createLogger('info', {
        events: WORKER_LOG_EVENTS,
        destination: new Writable({
          write(_chunk, _encoding, done) {
            done();
          },
        }),
      }),
      clock: { now: () => 1 },
      startupMs: 6_000,
      retryDelaysMs: [0, 60_000],
      // التأخير الطويل بعد قفل المحاولة التانية مبيخلّصش، فالاختبار ما يبنيش طابور تالت
      sleep: (ms) => (ms === 0 ? Promise.resolve() : new Promise<void>(() => undefined)),
      livenessIntervalMs: 60_000,
      createRenderer: () => new FakeRenderer(),
      onQueueConstructed: (queue) => {
        seen.push(queue);
      },
    });
    await until(() => {
      const first = seen[0];
      return (
        seen.length >= 2 &&
        first !== undefined &&
        isClosed(first.worker) &&
        first.connection.status === 'end'
      );
    });
    expect(seen).toHaveLength(2);
    const first = seen[0];
    if (first === undefined) throw new Error('missing first queue');
    expect(isClosed(first.worker)).toBe(true);
    expect(first.connection.status).toBe('end');
    expect(seen.filter((queue) => !isClosed(queue.worker))).toHaveLength(1);
  } finally {
    await handle?.close();
    redis.disconnect();
    await hang.stop();
  }
});
