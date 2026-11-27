import type { DocumentRenderer } from '@pospay/documents';
import { systemUuidV7 } from '@pospay/ids';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { expect, it } from 'vitest';

import { DRAIN_GRACE_MS, trackDocumentStartup } from '../startup-session.ts';
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

it('gives normal close drainGraceMs (default 35 s > 30 s budget) while keeping short browser closeGraceMs', async () => {
  expect(DRAIN_GRACE_MS).toBeGreaterThan(30_000);
  const events: string[] = [];
  let releaseWorker: (() => void) | undefined;
  const session = trackDocumentStartup({
    startupMs: 500,
    closeGraceMs: 25,
    drainGraceMs: 120,
    retryDelaysMs: [0],
    sleep: wait,
    stopped: () => false,
    onFailed: () => undefined,
    run: async (attempt) => {
      attempt.setLive({
        worker: {
          close: () =>
            new Promise<void>((resolve) => {
              events.push('worker-close-start');
              releaseWorker = () => {
                events.push('worker-close-done');
                resolve();
              };
            }),
        } as never,
        connection: { disconnect: () => events.push('redis-disconnect') } as never,
      });
      attempt.setRenderer(hangingCloseRenderer(events));
      return true;
    },
  });
  await session.started;
  const closing = session.close();
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(events).toEqual(['worker-close-start']);
  releaseWorker?.();
  await closing;
  expect(events).toEqual([
    'worker-close-start',
    'worker-close-done',
    'redis-disconnect',
    'renderer-close',
    'renderer-kill',
  ]);
});

it('escalates a real BullMQ worker via close(true) across the production stop-then-close sequence', async () => {
  const events: string[] = [];
  const { queue, worker, session, pickedUp, releaseJob, queueConnection, workerConnection } =
    createStuckWorkerSession(events);
  let closedEvent = false;
  worker.on('closed', () => {
    closedEvent = true;
  });
  try {
    await session.started;
    await queue.add('stuck-stop', {});
    await pickedUp;
    await session.stop();
    await session.close();
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
