import { beforeEach, expect, it, vi } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import type { TenantWrappers } from '@pospay/db';

import { startCatalogWorker } from '../catalog.module.ts';

// #1195: رفض قفل معالج واحد كان بيقفل الباقي قبل ما يتقفلوا، فبقى فيه طابور
// معلّق بعد إغلاق العامل.

const state = vi.hoisted(() => ({
  queues: [] as { name: string; close: ReturnType<typeof vi.fn> }[],
  workers: [] as { name: string; close: ReturnType<typeof vi.fn> }[],
}));

vi.mock('bullmq', () => ({
  Queue: class {
    add = vi.fn(async () => undefined);
    upsertJobScheduler = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
    on = vi.fn();
    constructor(readonly name: string) {
      state.queues.push(this);
    }
  },
  Worker: class {
    waitUntilReady = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
    on = vi.fn();
    constructor(
      readonly name: string,
      readonly processor: unknown,
    ) {
      state.workers.push(this);
    }
  },
  DelayedError: class DelayedError extends Error {},
  UnrecoverableError: class UnrecoverableError extends Error {},
}));

vi.mock('ioredis', () => ({
  Redis: class {
    duplicate() {
      return this;
    }
    on() {}
    disconnect() {}
  },
}));

const ids = systemUuidV7();

beforeEach(() => {
  state.queues.length = 0;
  state.workers.length = 0;
});

function startWorker() {
  return startCatalogWorker({} as Pick<TenantWrappers, 'withTenant'>, ids, 'synthetic', {
    now: () => new Date('2026-11-14T10:00:00.000Z'),
  });
}

it('closes every processor, waits for siblings to settle, and reports the first refusal', async () => {
  const catalog = startWorker();
  const closingWorker = state.workers.find((worker) => worker.name === 'service-category-closing');
  const importWorker = state.workers.find((worker) => worker.name === 'service-import-commit');
  const recoveryWorker = state.workers.find((worker) => worker.name === 'service-import-recovery');
  const failure = new Error('synthetic closing refusal');
  let releaseImportClose: (() => void) | undefined;
  let settled = false;

  closingWorker?.close.mockRejectedValueOnce(failure);
  importWorker?.close.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        releaseImportClose = resolve;
      }),
  );

  const closing = catalog.close().then(
    () => {
      settled = true;
    },
    (err: unknown) => {
      settled = true;
      throw err;
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);

  expect(releaseImportClose).toBeDefined();
  releaseImportClose?.();
  await expect(closing).rejects.toBe(failure);
  expect(importWorker?.close).toHaveBeenCalledTimes(1);
  expect(recoveryWorker?.close).toHaveBeenCalledTimes(1);
});
