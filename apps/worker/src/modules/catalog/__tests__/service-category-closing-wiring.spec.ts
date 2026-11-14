import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import type { ClaimedEvent, Database } from '@pospay/db';
import { startCatalogWorker } from '../catalog.module.ts';

const state = vi.hoisted(() => ({
  queues: [] as {
    name: string;
    add: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }[],
  workers: [] as {
    name: string;
    processor: (job: unknown, token?: string) => Promise<unknown>;
    waitUntilReady: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }[],
}));

vi.mock('bullmq', () => ({
  Queue: class {
    add = vi.fn();
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
      readonly processor: (job: unknown, token?: string) => Promise<unknown>,
    ) {
      state.workers.push(this);
    }
  },
  DelayedError: class DelayedError extends Error {},
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
const withTenant = vi.fn(async () => undefined);
let catalog: ReturnType<typeof startCatalogWorker>;

beforeEach(() => {
  state.queues.length = 0;
  state.workers.length = 0;
  withTenant.mockClear();
  catalog = startCatalogWorker(
    { withTenant } as unknown as Pick<Database, 'withTenant'>,
    ids,
    'synthetic',
    { now: () => new Date('2026-11-14T10:00:00.000Z') },
  );
});

afterEach(async () => {
  await catalog.close();
});

it('delivers the closing request to the queue by event id', async () => {
  const closingId = ids.newId();
  const event: ClaimedEvent = {
    id: ids.newId(),
    companyId: ids.newId(),
    aggregateId: closingId,
    aggregateType: 'service_category_closing',
    eventType: 'ServiceCategoryClosingRequested',
    payload: { closing_id: closingId },
    attempt: 1,
  };
  const next = vi.fn(async () => ({ delivered: true as const }));

  expect(await catalog.deliver(event, next)).toEqual({ delivered: true });
  expect(
    state.queues.find((queue) => queue.name === 'service-category-closing')?.add,
  ).toHaveBeenCalledWith(
    'run',
    { companyId: event.companyId, closingId },
    expect.objectContaining({ jobId: event.id }),
  );
  expect(next).not.toHaveBeenCalled();
});

it('hands an event of another type to the next handler', async () => {
  const event: ClaimedEvent = {
    id: ids.newId(),
    companyId: ids.newId(),
    aggregateId: ids.newId(),
    aggregateType: 'employee',
    eventType: 'EmployeeImported',
    payload: {},
    attempt: 1,
  };
  const next = vi.fn(async () => ({ delivered: true as const }));

  expect(await catalog.deliver(event, next)).toEqual({ delivered: true });
  expect(next).toHaveBeenCalledWith(event);
});

it('rejects readiness when the closing worker is not ready', async () => {
  state.workers
    .find((worker) => worker.name === 'service-category-closing')
    ?.waitUntilReady.mockRejectedValueOnce(new Error('synthetic not ready'));
  await expect(catalog.ready()).rejects.toThrow('synthetic not ready');
});
