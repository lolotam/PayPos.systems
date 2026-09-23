import { Writable } from 'node:stream';

import { Controller, Get, Req } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AuthService } from '@pospay/auth';
import { errorEnvelope } from '@pospay/contracts';
import { createLogger } from '@pospay/observability';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../app.ts';
import { API_LOG_EVENTS } from '../log-events.ts';

// T9a-1: deny by default. Better Auth itself (login, cookies, sign-out) is proven against Postgres in
// packages/auth; here the API's side — the guard, the principal, and the /v1/auth/* bridge.
const USER = '019c0000-0000-7000-8000-000000000001';

@Controller('probe')
class ProtectedProbe {
  @Get('me')
  me(@Req() request: FastifyRequest): { userId: string | null | undefined } {
    return { userId: request.principal?.userId };
  }
}

let seen: { method: string; url: string; body: string; cookie: string | null } | undefined;
const fakeAuth: AuthService = {
  handler: async (request) => {
    seen = {
      method: request.method,
      url: request.url,
      body: await request.text(),
      cookie: request.headers.get('cookie'),
    };
    if (request.url.endsWith('/explode')) throw new Error('secret internals tok_auth_leak');
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', 'pospay.session_token=abc; HttpOnly');
    headers.append('set-cookie', 'pospay.session_data=def; HttpOnly');
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  },
  getSession: async (headers) =>
    headers.get('cookie')?.includes('pospay.session_token=good') === true
      ? { userId: USER, sessionId: '019c0000-0000-7000-8000-000000000002' }
      : null,
  provisionUser: async () => USER,
  ping: async () => undefined,
  close: async () => undefined,
};

let app: NestFastifyApplication;
let bare: NestFastifyApplication;
let logs = '';

beforeAll(async () => {
  const sink = new Writable({
    write(chunk, _encoding, done) {
      logs += String(chunk);
      done();
    },
  });
  const logger = createLogger('info', { destination: sink, events: API_LOG_EVENTS });
  app = await createApp(
    { readiness: [], auth: { service: fakeAuth, baseURL: 'http://api.test' } },
    { controllers: [ProtectedProbe], logger },
  );
  bare = await createApp(
    { readiness: [] },
    { controllers: [ProtectedProbe], logger: createLogger('silent') },
  );
});

afterAll(async () => {
  await Promise.all([app.close(), bare.close()]);
});

describe('the session guard', () => {
  it('refuses a route without a session with 401 UNAUTHENTICATED', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/probe/me' });
    expect(res.statusCode).toBe(401);
    expect(errorEnvelope.parse(res.json()).code).toBe('UNAUTHENTICATED');
  });

  it('lets a verified session through and attaches its principal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/probe/me',
      headers: { cookie: 'pospay.session_token=good' },
    });
    expect([res.statusCode, res.json()]).toEqual([200, { userId: USER }]);
  });

  it('without auth configured, only @Public() routes answer', async () => {
    expect((await bare.inject({ method: 'GET', url: '/v1/probe/me' })).statusCode).toBe(401);
    expect((await bare.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe('the /v1/auth/* bridge', () => {
  it('forwards method, URL, body and cookie, and returns every Set-Cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in/email',
      headers: { cookie: 'a=1' },
      payload: { email: 'owner@example.test', password: 'pw_auth_leak' },
    });
    expect(res.statusCode).toBe(200);
    expect(seen).toMatchObject({
      method: 'POST',
      url: 'http://api.test/v1/auth/sign-in/email',
      cookie: 'a=1',
    });
    expect(JSON.parse(seen?.body ?? '{}')).toEqual({
      email: 'owner@example.test',
      password: 'pw_auth_leak',
    });
    expect(res.headers['set-cookie']).toEqual([
      'pospay.session_token=abc; HttpOnly',
      'pospay.session_data=def; HttpOnly',
    ]);
    expect(logs).not.toContain('pw_auth_leak');
  });

  it('turns a failure inside Better Auth into the envelope, never its message', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/explode', payload: {} });
    expect(res.statusCode).toBe(500);
    expect(errorEnvelope.parse(res.json()).code).toBe('INTERNAL_ERROR');
    expect(res.body + logs).not.toContain('tok_auth_leak');
  });
});
