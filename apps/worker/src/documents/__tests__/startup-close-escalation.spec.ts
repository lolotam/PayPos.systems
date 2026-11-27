import type { DocumentRenderer } from '@pospay/documents';
import { systemUuidV7 } from '@pospay/ids';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { expect, it, vi } from 'vitest';

import { DRAIN_GRACE_MS, trackDocumentStartup } from '../startup-session.ts';
import { redisUrl } from './render-harness.ts';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitUntil(ready: () => boolean, timeoutMs: number, message: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() >= deadline) throw new Error(message);
    await wait(10);
  }
}

function waitForWorkerClosed(worker: Worker, timeoutMs = 1_500): Promise<boolean> {
  return new Promise((resolve) => {
    const onClosed = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      worker.off('closed', onClosed);
      resolve(false);
    }, timeoutMs);
    worker.once('closed', onClosed);
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
  const closeSpy = vi.spyOn(worker, 'close');
  const closed = waitForWorkerClosed(worker);
  try {
    await session.started;
    await queue.add('stuck', {});
    await pickedUp;
    const startedAt = Date.now();
    await session.close();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(events).toEqual(['renderer-close', 'renderer-kill']);
    await expect(closed).resolves.toBe(true);
    expect(closeSpy).toHaveBeenCalledWith(true);
    expect(closeSpy).not.toHaveBeenCalledWith(false);
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
  const closeSpy = vi.spyOn(worker, 'close');
  const closed = waitForWorkerClosed(worker);
  try {
    await session.started;
    await queue.add('stuck-stop', {});
    await pickedUp;
    await session.stop();
    await session.close();
    expect(events).toEqual(['renderer-close', 'renderer-kill']);
    await expect(closed).resolves.toBe(true);
    expect(closeSpy).toHaveBeenCalledWith(true);
    expect(closeSpy).not.toHaveBeenCalledWith(false);
    expect(worker.isPaused()).toBe(true);
  } finally {
    releaseJob();
    await worker.close(true).catch(() => undefined);
    await queue.close().catch(() => undefined);
    workerConnection.disconnect();
    queueConnection.disconnect();
  }
}, 15_000);

it('waits past 500 ms kill grace until renderer kill confirms exit before starting the next attempt', async () => {
  let attempts = 0;
  let releaseKill: (() => void) | undefined;
  let killResolved = false;
  const session = trackDocumentStartup({
    startupMs: 500,
    closeGraceMs: 20,
    retryDelaysMs: [0],
    sleep: wait,
    stopped: () => false,
    onFailed: () => undefined,
    run: async (attempt) => {
      attempts += 1;
      if (attempts > 1) return true;
      attempt.setRenderer({
        async start() {
          return undefined;
        },
        close: () => new Promise<void>(() => undefined),
        kill: () =>
          new Promise<void>((resolve) => {
            releaseKill = () => {
              killResolved = true;
              resolve();
            };
          }),
        isAvailable: () => false,
        onUnavailable: () => undefined,
        onAvailable: () => undefined,
        async render() {
          return new Uint8Array();
        },
      });
      return false;
    },
  });
  try {
    await wait(580);
    expect(releaseKill).toBeDefined();
    expect(killResolved).toBe(false);
    expect(attempts).toBe(1);
    releaseKill?.();
    await session.started;
    expect(killResolved).toBe(true);
    expect(attempts).toBe(2);
  } finally {
    await session.close();
  }
});

it('blocks replacement startup when renderer kill rejects while keeping session close bounded', async () => {
  let attempts = 0;
  const session = trackDocumentStartup({
    startupMs: 500,
    closeGraceMs: 20,
    retryDelaysMs: [0],
    sleep: wait,
    stopped: () => false,
    onFailed: () => undefined,
    run: async (attempt) => {
      attempts += 1;
      attempt.setRenderer({
        async start() {
          return undefined;
        },
        close: () => new Promise<void>(() => undefined),
        kill: () => Promise.reject(new Error('EPERM')),
        isAvailable: () => false,
        onUnavailable: () => undefined,
        onAvailable: () => undefined,
        async render() {
          return new Uint8Array();
        },
      });
      return false;
    },
  });
  await wait(80);
  expect(attempts).toBe(1);
  const startedAt = Date.now();
  await session.close();
  expect(Date.now() - startedAt).toBeLessThan(1_000);
  expect(attempts).toBe(1);
});

function stalledPendingRenderer(onKillReady: (release: () => void) => void): DocumentRenderer {
  return {
    start: async () => undefined,
    close: () => new Promise<void>(() => undefined),
    kill: () => new Promise<void>((resolve) => onKillReady(resolve)),
    isAvailable: () => false,
    onUnavailable: () => undefined,
    onAvailable: () => undefined,
    render: async () => new Uint8Array(),
  };
}

function delayedCloseRenderer(onClosed: () => void): { renderer: DocumentRenderer; release: () => void } {
  let release: () => void = () => undefined;
  return {
    release: () => release(),
    renderer: {
      start: async () => undefined,
      close: () =>
        new Promise<void>((resolve) => {
          release = () => {
            onClosed();
            resolve();
          };
        }),
      kill: () => new Promise<void>(() => undefined),
      isAvailable: () => false,
      onUnavailable: () => undefined,
      onAvailable: () => undefined,
      render: async () => new Uint8Array(),
    },
  };
}

it('rechecks pendingExit when an abandoned renderer arrives while waitPendingExit is waiting', async () => {
  let attempts = 0;
  let abandonedClosed = false;
  let releaseFirstKill: (() => void) | undefined;
  let resolveLateAttemptOne!: (renderer: DocumentRenderer) => void;
  const lateAttemptOne = new Promise<DocumentRenderer>((resolve) => {
    resolveLateAttemptOne = resolve;
  });
  const session = trackDocumentStartup({
    startupMs: 40,
    closeGraceMs: 20,
    retryDelaysMs: [0],
    sleep: wait,
    stopped: () => false,
    onFailed: () => undefined,
    run: async (attempt) => {
      attempts += 1;
      if (attempts === 1) {
        attempt.setRenderer(await lateAttemptOne);
        return true;
      }
      if (attempts === 2) {
        attempt.setRenderer(stalledPendingRenderer((r) => (releaseFirstKill = r)));
        return false;
      }
      return true;
    },
  });
  try {
    await waitUntil(() => releaseFirstKill !== undefined, 2_000, 'releaseFirstKill timed out');
    await wait(550);
    const abandoned = delayedCloseRenderer(() => {
      abandonedClosed = true;
    });
    resolveLateAttemptOne(abandoned.renderer);
    await wait(50);
    releaseFirstKill?.();
    await wait(60);
    expect(abandonedClosed).toBe(false);
    expect(attempts).toBe(2);
    abandoned.release();
    await session.started;
    expect(abandonedClosed).toBe(true);
    expect(attempts).toBe(3);
  } finally {
    await session.close();
  }
});

it('holds replacement under matching worker and PlaywrightDocumentRenderer closeGraceMs until slow kill settles', async () => {
  const { PlaywrightDocumentRenderer } = await import('@pospay/documents');
  let launches = 0;
  let releaseKill: (() => void) | undefined;
  const session = trackDocumentStartup({
    startupMs: 500,
    closeGraceMs: 20,
    retryDelaysMs: [0],
    sleep: wait,
    stopped: () => false,
    onFailed: () => undefined,
    run: async (attempt) => {
      launches += 1;
      if (launches > 1) return true;
      const renderer = new PlaywrightDocumentRenderer({
        factory: {
          launch: async () => ({
            newContext: () => new Promise(() => undefined),
            close: () => new Promise(() => undefined),
            kill: () => new Promise<void>((r) => (releaseKill = r)),
            on: () => undefined,
          }),
        },
        closeGraceMs: 20,
        sleep: wait,
      });
      attempt.setRenderer(renderer);
      await renderer.start();
      return false;
    },
  });
  try {
    await waitUntil(() => releaseKill !== undefined, 2_000, 'Playwright kill was not triggered');
    await wait(560);
    expect(launches).toBe(1);
    releaseKill?.();
    await session.started;
    expect(launches).toBe(2);
  } finally {
    await session.close();
  }
});
