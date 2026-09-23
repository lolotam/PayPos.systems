import { Writable } from 'node:stream';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { errorEnvelope } from '@pospay/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.ts';
import type { ReadinessCheck } from '../readiness.ts';

const up: ReadinessCheck = { name: 'database', check: async () => undefined };
const down = (name: string): ReadinessCheck => ({
  name,
  check: async () => {
    throw new Error('connection refused');
  },
});
const hangs = (name: string): ReadinessCheck => ({
  name,
  check: () => new Promise(() => undefined),
});

let app: NestFastifyApplication | undefined;

const start = async (readiness: ReadinessCheck[]) => {
  // Swallow the request logs; errors.spec.ts is the one that reads them.
  const sink = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  app = await createApp({ readiness }, { logDestination: sink });
  return app;
};

const request = async (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) => {
  if (app === undefined) throw new Error('app not started');
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
};

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('/health and /ready', () => {
  it('/health is 200 even when every dependency is down', async () => {
    await start([down('database'), down('redis')]);
    expect(await request('GET', '/health')).toEqual({ status: 200, body: { status: 'ok' } });
  });

  it('/ready is 200 when every dependency answers', async () => {
    await start([up, { ...up, name: 'redis' }]);
    expect(await request('GET', '/ready')).toEqual({
      status: 200,
      body: { status: 'ready', checks: { database: 'up', redis: 'up' } },
    });
  });

  it.each([
    [
      'the database is down',
      [down('database'), { ...up, name: 'redis' }],
      { database: 'down', redis: 'up' },
    ],
    ['redis is down', [up, down('redis')], { database: 'up', redis: 'down' }],
    ['a dependency hangs', [up, hangs('redis')], { database: 'up', redis: 'down' }],
  ])('/ready is 503 with the error envelope when %s', async (_label, checks, states) => {
    await start(checks);
    const res = await request('GET', '/ready');
    expect(res.status).toBe(503);
    expect(errorEnvelope.parse(res.body)).toMatchObject({
      code: 'NOT_READY',
      details: { checks: states },
    });
  });
});
