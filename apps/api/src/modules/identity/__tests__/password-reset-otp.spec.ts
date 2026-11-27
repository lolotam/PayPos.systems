import { Writable } from 'node:stream';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AuthService, PasswordResetOtpApi } from '@pospay/auth';
import { createLogger } from '@pospay/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app.ts';
import { API_LOG_EVENTS } from '../../../shared/log-events.ts';

const ORIGIN = 'https://admin.synthetic.invalid';
const CHALLENGE = '01920000-0000-7000-8000-000000000001';
const RESET = {
  challenge_id: CHALLENGE,
  code: '123456',
  new_password: 'a-new-password',
};

let app: NestFastifyApplication | undefined;
const authHandler = vi.fn(async () => new Response('{}', { status: 200 }));

function fakeApi(overrides: Partial<PasswordResetOtpApi> = {}): PasswordResetOtpApi {
  return {
    request: vi.fn(async () => ({ kind: 'accepted' as const, challengeId: CHALLENGE })),
    reset: vi.fn(async () => ({ kind: 'reset' as const })),
    readiness: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  } as PasswordResetOtpApi;
}

async function start(passwordReset: PasswordResetOtpApi | null) {
  const sink = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  app = await createApp(
    {
      readiness: [],
      passwordReset,
      corsOrigins: [ORIGIN],
      // مسار Better Auth المحاكى: لو الطلب وصله يبقى المسار الأخص اتخطّى.
      auth: {
        service: {
          handler: authHandler,
          ping: async () => undefined,
          staffUsers: { staffCompanyOf: async () => null },
          passkeys: null,
        } as unknown as AuthService,
        baseURL: 'https://api.synthetic.invalid',
      },
    },
    { logger: createLogger('info', { destination: sink, events: [...API_LOG_EVENTS] }) },
  );
}

const post = (url: string, payload: unknown, origin: string | null = ORIGIN) =>
  running().inject({
    method: 'POST',
    url,
    payload: payload as Record<string, unknown>,
    headers: origin === null ? {} : { origin },
  });

function running(): NestFastifyApplication {
  if (app === undefined) throw new Error('app not started');
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
  authHandler.mockClear();
});

const body = { email: 'owner@example.invalid', locale: 'en' };

describe('POST /v1/auth/password-reset/otp/request', () => {
  it('answers 202 with the fixed acknowledgement shape, no session needed, and bypasses Better Auth', async () => {
    const api = fakeApi();
    await start(api);
    const response = await post('/v1/auth/password-reset/otp/request', body);
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      status: 'ACCEPTED',
      challenge_id: CHALLENGE,
      expires_in: 600,
      retry_after: 60,
    });
    expect(api.request).toHaveBeenCalledWith(expect.objectContaining(body));
    expect(authHandler).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After when limited', async () => {
    await start(
      fakeApi({ request: vi.fn(async () => ({ kind: 'limited' as const, retryAfter: 42 })) }),
    );
    const response = await post('/v1/auth/password-reset/otp/request', body);
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('42');
    expect(response.json()).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('answers 503 OTP_UNAVAILABLE when the capability is down or absent', async () => {
    await start(fakeApi({ request: vi.fn(async () => ({ kind: 'unavailable' as const })) }));
    const down = await post('/v1/auth/password-reset/otp/request', body);
    expect(down.statusCode).toBe(503);
    expect(down.json()).toMatchObject({ code: 'OTP_UNAVAILABLE' });
    await app?.close();
    await start(null);
    const absent = await post('/v1/auth/password-reset/otp/request', body);
    expect(absent.statusCode).toBe(503);
    expect(absent.json()).toMatchObject({ code: 'OTP_UNAVAILABLE' });
  });
});

describe('POST /v1/auth/password-reset/otp/request guards', () => {
  it('refuses an untrusted or missing origin before the service is called', async () => {
    const api = fakeApi();
    await start(api);
    for (const origin of ['https://evil.invalid', null]) {
      const response = await post('/v1/auth/password-reset/otp/request', body, origin);
      expect(response.statusCode).toBe(403);
    }
    expect(api.request).not.toHaveBeenCalled();
  });

  it('rejects an unknown key or a malformed email with a validation error and no service call', async () => {
    const api = fakeApi();
    await start(api);
    const extra = await post('/v1/auth/password-reset/otp/request', { ...body, role: 'owner' });
    const malformed = await post('/v1/auth/password-reset/otp/request', { ...body, email: 'nope' });
    expect(extra.statusCode).toBe(400);
    expect(malformed.statusCode).toBe(400);
    expect(api.request).not.toHaveBeenCalled();
  });

  it('refuses a body over 1024 bytes even when every field is valid', async () => {
    const api = fakeApi();
    await start(api);
    const response = await running().inject({
      method: 'POST',
      url: '/v1/auth/password-reset/otp/request',
      payload: JSON.stringify(body) + ' '.repeat(1100),
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(413);
    expect(api.request).not.toHaveBeenCalled();
  });
});

describe('POST /v1/auth/password-reset/otp/reset', () => {
  it('answers 200 RESET and issues no cookie', async () => {
    const api = fakeApi();
    await start(api);
    const response = await post('/v1/auth/password-reset/otp/reset', RESET);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'RESET' });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(api.reset).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: CHALLENGE,
        code: '123456',
        newPassword: 'a-new-password',
      }),
    );
    expect(authHandler).not.toHaveBeenCalled();
  });

  it('answers OTP_INVALID for a wrong code and does not echo any detail', async () => {
    await start(fakeApi({ reset: vi.fn(async () => ({ kind: 'invalid' as const })) }));
    const response = await post('/v1/auth/password-reset/otp/reset', RESET);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'OTP_INVALID' });
  });

  it('answers 429 with Retry-After and 503 when unavailable', async () => {
    await start(
      fakeApi({ reset: vi.fn(async () => ({ kind: 'limited' as const, retryAfter: 7 })) }),
    );
    const limited = await post('/v1/auth/password-reset/otp/reset', RESET);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('7');
    await app?.close();
    await start(fakeApi({ reset: vi.fn(async () => ({ kind: 'unavailable' as const })) }));
    const down = await post('/v1/auth/password-reset/otp/reset', RESET);
    expect(down.statusCode).toBe(503);
  });

  it.each([
    ['a five-digit code', { ...RESET, code: '12345' }],
    ['a non-numeric code', { ...RESET, code: '12345a' }],
    ['a seven-character password', { ...RESET, new_password: 'short77' }],
    ['a password over 128 characters', { ...RESET, new_password: 'x'.repeat(129) }],
    ['an extra key', { ...RESET, user_id: 'x' }],
  ])('rejects %s without calling the service', async (_name, payload) => {
    const api = fakeApi();
    await start(api);
    const response = await post('/v1/auth/password-reset/otp/reset', payload);
    expect([400, 413]).toContain(response.statusCode);
    expect(api.reset).not.toHaveBeenCalled();
  });
});

describe('the routes sit beside Better Auth, not inside it', () => {
  it('still hands every other /v1/auth path to Better Auth', async () => {
    await start(fakeApi());
    await running().inject({ method: 'POST', url: '/v1/auth/sign-in/email', payload: {} });
    expect(authHandler).toHaveBeenCalledTimes(1);
  });
});
