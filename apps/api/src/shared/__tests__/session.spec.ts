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
const ADMIN = 'http://admin.test';

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
    if (request.url.endsWith('/refuse')) {
      const refused = new Headers({ 'content-type': 'application/json' });
      refused.append('set-cookie', 'pospay.session_token=; Max-Age=0');
      return new Response(
        JSON.stringify({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }),
        { status: 401, headers: refused },
      );
    }
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', 'pospay.session_token=abc; HttpOnly');
    headers.append('set-cookie', 'pospay.session_data=def; HttpOnly');
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  },
  getSession: async (headers) => {
    const cookie = headers.get('cookie') ?? '';
    if (!/pospay\.session_token=(good|old)/.test(cookie)) return null;
    // An "old" session is renewed, as Better Auth does once updateAge has passed.
    const setCookies = cookie.includes('=old') ? ['pospay.session_token=renewed; HttpOnly'] : [];
    return { userId: USER, sessionId: '019c0000-0000-7000-8000-000000000002', setCookies };
  },
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
    {
      readiness: [],
      auth: { service: fakeAuth, baseURL: 'http://api.test' },
      corsOrigins: [ADMIN],
    },
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

  it('forwards the cookie of a renewed session, so the browser keeps it past the old expiry', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/probe/me',
      headers: { cookie: 'pospay.session_token=old' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toEqual(['pospay.session_token=renewed; HttpOnly']);
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

describe('refusals and cross-origin calls', () => {
  it('a Better Auth refusal leaves as the envelope, keeping its code and its cookies', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/refuse', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(errorEnvelope.parse(res.json())).toMatchObject({
      code: 'AUTHENTICATION_FAILED',
      details: { auth_code: 'INVALID_EMAIL_OR_PASSWORD' },
    });
    expect(res.body).not.toContain('Invalid email or password');
    expect(res.headers['set-cookie']).toEqual(['pospay.session_token=; Max-Age=0']);
  });

  it('answers a preflight from an allowed origin with credentials, and ignores any other origin', async () => {
    const preflight = (origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/v1/auth/sign-in/email',
        headers: { origin, 'access-control-request-method': 'POST' },
      });
    const allowed = await preflight(ADMIN);
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(ADMIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const other = await preflight('http://evil.test');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});
