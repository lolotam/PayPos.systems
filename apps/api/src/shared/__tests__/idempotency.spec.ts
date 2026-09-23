import { Controller, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { errorEnvelope } from '@pospay/contracts';
import { IdempotencyKeyBusyError, IdempotencyKeyReusedError } from '@pospay/db';
import { createLogger } from '@pospay/observability';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../app.ts';
import { Public } from '../public.decorator.ts';
import { codeForStatus } from '../errors.ts';
import { Idempotency, requestFingerprint, type IdempotencyInput } from '../idempotency.ts';

// The HTTP half of plan v4 T7: the header is required and validated, the fingerprint is stable, and the
// two runIdempotent failures reach the client as their own catalogued codes. The database half — replay,
// 422 on a different body, concurrency — is proven in packages/db against real Postgres.
// Public: this probe tests the envelope and idempotency mechanics, not authentication.
@Public()
@Controller('probe')
class IdempotentProbe {
  @Post('orders/:id/refund')
  refund(@Idempotency() idempotency: IdempotencyInput): IdempotencyInput {
    return idempotency;
  }

  @Post('echo')
  echo(@Idempotency() idempotency: IdempotencyInput): IdempotencyInput {
    return idempotency;
  }

  @Post('reused')
  // The decorator still runs first, so these routes need a valid key too — as a real endpoint would.
  reused(@Idempotency() idempotency: IdempotencyInput): never {
    throw Object.assign(new IdempotencyKeyReusedError(), { key: idempotency.key });
  }

  @Post('busy')
  busy(@Idempotency() idempotency: IdempotencyInput): never {
    throw Object.assign(new IdempotencyKeyBusyError(), { key: idempotency.key });
  }
}

let app: NestFastifyApplication;

const post = async (url: string, headers: Record<string, string>, payload: object = {}) => {
  const res = await app.inject({ method: 'POST', url, headers, payload });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
};

beforeAll(async () => {
  app = await createApp(
    { readiness: [] },
    { controllers: [IdempotentProbe], logger: createLogger('silent') },
  );
});

afterAll(async () => {
  await app.close();
});

describe('the Idempotency-Key header', () => {
  it.each([
    ['missing', {}],
    ['empty', { 'idempotency-key': '' }],
    ['with a space', { 'idempotency-key': 'has space' }],
    ['too long', { 'idempotency-key': 'k'.repeat(256) }],
  ])('%s → 400 IDEMPOTENCY_KEY_REQUIRED', async (_label, headers) => {
    const res = await post('/v1/probe/echo', headers);
    expect(res.status).toBe(400);
    expect(errorEnvelope.parse(res.body).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('a valid key reaches the handler with a fingerprint that ignores key order', async () => {
    const headers = { 'idempotency-key': 'order-7f3a' };
    const a = await post('/v1/probe/echo', headers, { b: 2, a: { y: 1, x: [3, 1] } });
    const b = await post('/v1/probe/echo', headers, { a: { x: [3, 1], y: 1 }, b: 2 });
    expect(a.status).toBe(201);
    expect(a.body).toEqual({
      key: 'order-7f3a',
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(b.body['fingerprint']).toBe(a.body['fingerprint']);
  });
});

describe('requestFingerprint', () => {
  const base = {
    method: 'POST',
    route: '/v1/businesses',
    params: {},
    query: {},
    body: { name_en: 'Main', tags: ['a', 'b'] },
  };

  it('changes with the body, the array order, the route and the method', () => {
    const reference = requestFingerprint(base);
    expect(requestFingerprint({ ...base, body: { name_en: 'Other', tags: ['a', 'b'] } })).not.toBe(
      reference,
    );
    expect(requestFingerprint({ ...base, body: { name_en: 'Main', tags: ['b', 'a'] } })).not.toBe(
      reference,
    );
    expect(requestFingerprint({ ...base, route: '/v1/branches' })).not.toBe(reference);
    expect(requestFingerprint({ ...base, method: 'PUT' })).not.toBe(reference);
    expect(requestFingerprint({ ...base, query: { dry_run: 'true' } })).not.toBe(reference);
  });

  it('two targets of one route with the same key and body are different requests', async () => {
    const headers = { 'idempotency-key': 'refund-1' };
    const a = await post('/v1/probe/orders/0194aaaa-0000-7000-8000-00000000000a/refund', headers, {
      amount: '1.000',
    });
    const b = await post('/v1/probe/orders/0194bbbb-0000-7000-8000-00000000000b/refund', headers, {
      amount: '1.000',
    });
    const again = await post(
      '/v1/probe/orders/0194aaaa-0000-7000-8000-00000000000a/refund',
      headers,
      { amount: '1.000' },
    );
    expect(b.body['fingerprint']).not.toBe(a.body['fingerprint']);
    expect(again.body['fingerprint']).toBe(a.body['fingerprint']);
  });
});

describe('runIdempotent failures reach the client as catalogued codes', () => {
  it('a reused key is 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const res = await post('/v1/probe/reused', { 'idempotency-key': 'k1' });
    expect(res.status).toBe(422);
    expect(errorEnvelope.parse(res.body).code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('a request still in progress is a retryable 409 IDEMPOTENCY_KEY_IN_PROGRESS', async () => {
    const res = await post('/v1/probe/busy', { 'idempotency-key': 'k1' });
    expect(res.status).toBe(409);
    expect(errorEnvelope.parse(res.body).code).toBe('IDEMPOTENCY_KEY_IN_PROGRESS');
  });

  it('a bare framework 409 or 422 is never reported as an idempotency failure', () => {
    expect(codeForStatus(409)).toBe('BAD_REQUEST');
    expect(codeForStatus(422)).toBe('BAD_REQUEST');
    expect(codeForStatus(400)).toBe('BAD_REQUEST');
  });
});
