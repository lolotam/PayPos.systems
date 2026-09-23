import { createLogger } from '@pospay/observability';
import { describe, expect, it } from 'vitest';

import { createWorker } from '../../worker.ts';
import type { ReadinessCheck } from '../health.controller.ts';

const up: ReadinessCheck = { name: 'database', check: async () => undefined };
const down: ReadinessCheck = {
  name: 'redis',
  check: async () => {
    throw new Error('ECONNREFUSED');
  },
};
const hangs: ReadinessCheck = { name: 'redis', check: () => new Promise<void>(() => undefined) };

const build = (readiness: ReadinessCheck[] = [up], order: string[] = []) =>
  createWorker(
    {
      readiness,
      stopPolling: async () => {
        order.push('stop polling');
      },
      release: async () => {
        order.push('release pools');
      },
    },
    createLogger('silent'),
  );

describe('worker HTTP', () => {
  it('/health is 200 without touching any dependency', async () => {
    const app = await build([down]);
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect([res.statusCode, res.json()]).toEqual([200, { status: 'ok' }]);
    } finally {
      await app.close();
    }
  });

  it('/ready is 200 when every dependency answers', async () => {
    const app = await build([up]);
    try {
      expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['fails', down],
    ['hangs', hangs],
  ])('/ready is 503 in the error envelope when Redis %s', async (_label, check) => {
    const app = await build([up, check]);
    try {
      const res = await app.inject({ method: 'GET', url: '/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({
        code: 'NOT_READY',
        details: { checks: { database: 'up', redis: 'down' } },
      });
    } finally {
      await app.close();
    }
  });
});

describe('shutdown', () => {
  it('stops polling before it releases the pools', async () => {
    const order: string[] = [];
    const app = await build([up], order);
    await app.close();
    expect(order).toEqual(['stop polling', 'release pools']);
  });
});
