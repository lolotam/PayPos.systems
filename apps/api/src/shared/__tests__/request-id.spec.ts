import { connect } from 'node:net';
import { Writable } from 'node:stream';

import { Controller, Get } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger } from '@pospay/observability';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../app.ts';
import { Public } from '../public.decorator.ts';

// T11: each request's log lines carry its own id — even when HTTP pipelining makes Node flush one request's response
// from another request's completion — and requests the router rejects still get an id and a log line.
@Public()
@Controller('probe/timing')
class Timing {
  @Get('slow')
  async slow(): Promise<{ ok: true }> {
    await new Promise((done) => setTimeout(done, 300));
    return { ok: true };
  }

  @Get('fast')
  fast(): { ok: true } {
    return { ok: true };
  }
}

const lines: Record<string, unknown>[] = [];
let app: NestFastifyApplication;
let port: number;

beforeAll(async () => {
  const destination = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split('\n').filter(Boolean)) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      done();
    },
  });
  app = await createApp(
    { readiness: [], corsOrigins: ['http://admin.test'] },
    { controllers: [Timing], logger: createLogger('info', { destination }) },
  );
  await app.listen({ host: '127.0.0.1', port: 0 });
  port = (app.getHttpServer().address() as { port: number }).port;
});

afterAll(async () => {
  await app.close();
});

const completedLines = () => lines.filter((line) => line['msg'] === 'request completed');

// Two requests written back to back on one socket: the slow one first, so the fast one finishes first and waits.
function pipelined(): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let received = '';
    socket.on('data', (chunk) => {
      received += String(chunk);
      if ((received.match(/HTTP\/1\.1 200/g) ?? []).length === 2) {
        socket.end();
        resolve(received);
      }
    });
    socket.on('error', reject);
    socket.write(
      'GET /v1/probe/timing/slow HTTP/1.1\r\nHost: api.test\r\nX-Request-Id: slow-request-0001\r\n\r\n' +
        'GET /v1/probe/timing/fast HTTP/1.1\r\nHost: api.test\r\nX-Request-Id: fast-request-0001\r\n\r\n',
    );
  });
}

describe('request ids under HTTP pipelining', () => {
  it("each completion line carries its own request's id, not the one being flushed around it", async () => {
    await pipelined();
    await new Promise((done) => setTimeout(done, 50));
    const byRoute = Object.fromEntries(
      completedLines().map((line) => [
        (line['http'] as { route: string }).route,
        line['request_id'],
      ]),
    );
    expect(byRoute).toMatchObject({
      '/v1/probe/timing/slow': 'slow-request-0001',
      '/v1/probe/timing/fast': 'fast-request-0001',
    });
  });
});

describe('requests the router rejects', () => {
  it('still get an id, echoed in the response and on their completion line', async () => {
    const res = await app.inject({ method: 'GET', url: '/%ZZ' });
    expect(res.statusCode).toBe(400);
    const id = String(res.headers['x-request-id']);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(completedLines().some((line) => line['request_id'] === id)).toBe(true);
  });
});

describe('browsers can send and read the request id', () => {
  it('the preflight allows X-Request-Id and the response exposes it', async () => {
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/probe/timing/fast',
      headers: {
        origin: 'http://admin.test',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'x-request-id',
      },
    });
    expect(String(preflight.headers['access-control-allow-headers'])).toMatch(/x-request-id/i);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/probe/timing/fast',
      headers: { origin: 'http://admin.test' },
    });
    expect(String(res.headers['access-control-expose-headers'])).toMatch(/x-request-id/i);
  });
});
