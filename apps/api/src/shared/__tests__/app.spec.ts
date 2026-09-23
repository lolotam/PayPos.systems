import { Writable } from 'node:stream';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { errorEnvelope } from '@pospay/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { createLogger } from '@pospay/observability';

import { createApp } from '../../app.ts';
import { API_LOG_EVENTS } from '../log-events.ts';
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
  app = await createApp(
    { readiness },
    { logger: createLogger('info', { destination: sink, events: [...API_LOG_EVENTS, 'probe'] }) },
  );
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

describe('readiness under a stalled dependency', () => {
  it('keeps at most one probe outstanding however many times /ready is called', async () => {
    let calls = 0;
    const stalled: ReadinessCheck = {
      name: 'redis',
      check: () => {
        calls += 1;
        return new Promise(() => undefined);
      },
    };
    await start([up, stalled]);
    const results = await Promise.all([request('GET', '/ready'), request('GET', '/ready')]);
    await request('GET', '/ready');
    expect(results.map((r) => r.status)).toEqual([503, 503]);
    expect(calls).toBe(1);
    // While the stalled probe is still pending, /ready answers from the settled timeout at once.
    const started = Date.now();
    expect((await request('GET', '/ready')).status).toBe(503);
    expect(Date.now() - started).toBeLessThan(500);
    expect(calls).toBe(1);
  });
});

describe('shutdown', () => {
  it('releases the dependencies through the lifecycle hook when the app closes', async () => {
    let released = 0;
    app = await createApp(
      { readiness: [], onShutdown: async () => void (released += 1) },
      {
        logger: createLogger('info', {
          destination: new Writable({ write: (_c, _e, done) => done() }),
        }),
      },
    );
    await app.close();
    app = undefined;
    expect(released).toBe(1);
  });
});
