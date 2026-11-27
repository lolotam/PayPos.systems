import type { DocumentRenderer } from '@pospay/documents';
import { systemUuidV7 } from '@pospay/ids';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { expect, it } from 'vitest';

import { trackDocumentStartup } from '../startup-session.ts';
import { redisUrl } from './render-harness.ts';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function hangingCloseRenderer(events: string[]): DocumentRenderer {
  return {
    async start() {
      return undefined;
    },
    close: () => {
      events.push('renderer-close');
      return new Promise<void>(() => undefined);
    },
    kill: () => {
      events.push('renderer-kill');
    },
    isAvailable: () => true,
    onUnavailable: () => undefined,
    onAvailable: () => undefined,
    async render() {
      return new Uint8Array();
    },
  };
}

function createStuckWorkerSession(events: string[]) {
  const queueName = `grace-escalate-${systemUuidV7().newId()}`;
  const queueConnection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  const workerConnection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  const queue = new Queue(queueName, { connection: queueConnection });
  let releaseJob: (() => void) | undefined;
  let markPickedUp: (() => void) | undefined;
  const pickedUp = new Promise<void>((resolve) => {
    markPickedUp = resolve;
  });
  const worker = new Worker(
    queueName,
    () =>
      new Promise<void>((resolve) => {
        markPickedUp?.();
        releaseJob = resolve;
      }),
    { connection: workerConnection },
  );
  const session = trackDocumentStartup({
    startupMs: 2_000,
    closeGraceMs: 60,
    retryDelaysMs: [0],
    sleep: wait,
    stopped: () => false,
    onFailed: () => undefined,
    run: async (attempt) => {
      await worker.waitUntilReady();
      attempt.setLive({ worker, connection: workerConnection });
      attempt.setRenderer(hangingCloseRenderer(events));
      return true;
    },
  });
  return { queue, worker, session, pickedUp, releaseJob: () => releaseJob?.(), queueConnection, workerConnection };
}

it('escalates a real BullMQ worker via close(true) when close grace expires during a stuck job', async () => {
  const events: string[] = [];
  const { queue, worker, session, pickedUp, releaseJob, queueConnection, workerConnection } =
    createStuckWorkerSession(events);
  let closedEvent = false;
  worker.on('closed', () => {
    closedEvent = true;
  });
  try {
    await session.started;
    await queue.add('stuck', {});
    await pickedUp;
    const startedAt = Date.now();
    await session.close();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(events).toEqual(['renderer-close', 'renderer-kill']);
    await expect(worker.close(true)).resolves.toBeUndefined();
    expect(closedEvent).toBe(true);
    expect(worker.isPaused()).toBe(true);
  } finally {
    releaseJob();
    await worker.close(true).catch(() => undefined);
    await queue.close().catch(() => undefined);
    workerConnection.disconnect();
    queueConnection.disconnect();
  }
}, 15_000);
