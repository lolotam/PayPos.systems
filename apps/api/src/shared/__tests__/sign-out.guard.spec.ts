import { createLogger } from '@pospay/observability';
import { errorEnvelope } from '@pospay/contracts';
import type { PersonalSessions, StaffSessions } from '@pospay/auth';
import type { FastifyRequest } from 'fastify';
import { expect, it } from 'vitest';

import { createApp } from '../../app.ts';
import { ApiError } from '../errors.ts';
import type { PersonalAuthentication } from '../personal-authentication.ts';
import type { RateLimiter } from '../ports/rate-limiter.port.ts';
import {
  SIGN_OUT_ROUTE,
  SignOutRoute,
  signOutRequest,
  type SignOutWiring,
} from '../sign-out.guard.ts';

const STAFF_ORIGIN = 'http://pos.synthetic.invalid';
const PERSONAL_ORIGIN = 'http://localhost:5173';

const fakeLimiter = (allowed: boolean) => {
  const calls: { key: string; limit: number; window: number }[] = [];
  const limiter = {
    hit: async (key: string, limit: number, window: number) => {
      calls.push({ key, limit, window });
      return allowed;
    },
  };
  return { calls, limiter: limiter as unknown as RateLimiter };
};

const personalAuthentication = {
  origin: PERSONAL_ORIGIN,
  sessions: {} as PersonalSessions,
  otp: null,
  eligibility: {} as PersonalAuthentication['eligibility'],
};

const wiringFor = (overrides: Partial<SignOutWiring> = {}): SignOutWiring => ({
  staffSessions: {} as StaffSessions,
  staffOrigin: STAFF_ORIGIN,
  personal: personalAuthentication,
  limiter: null,
  ...overrides,
});

// The request is a plain object: the policy reads the origin, the authorization header and the IP, nothing else.
const requestWith = (headers: Record<string, string | undefined>) => {
  const reads: string[] = [];
  const proxy = new Proxy(headers, {
    get(target, key) {
      reads.push(String(key));
      return target[key as string];
    },
  });
  return { request: { headers: proxy, ip: '10.0.0.9' } as unknown as FastifyRequest, reads };
};

const codeOf = async (promise: Promise<boolean>): Promise<string> =>
  promise.then(
    () => 'NO_REFUSAL',
    (error: unknown) => (error instanceof ApiError ? error.code : 'NOT_AN_API_ERROR'),
  );

it('SO-15 every missing wiring piece refuses with not ready, before the origin is read', async () => {
  const limiter = fakeLimiter(true).limiter;
  const missing: [SignOutWiring, 'staff' | 'personal'][] = [
    [wiringFor({ staffSessions: null, limiter }), 'staff'],
    [wiringFor({ staffOrigin: null, limiter }), 'staff'],
    [wiringFor({ personal: null, limiter }), 'personal'],
    [wiringFor({ limiter: null }), 'staff'],
  ];
  for (const [wiring, kind] of missing) {
    const { request } = requestWith({ origin: 'https://wrong.synthetic.invalid' });
    expect(await codeOf(signOutRequest(request, kind, wiring))).toBe('NOT_READY');
  }
});

it('a wrong origin is refused before the limiter is touched', async () => {
  const fake = fakeLimiter(true);
  const { request } = requestWith({ origin: 'https://wrong.synthetic.invalid' });
  expect(await codeOf(signOutRequest(request, 'staff', wiringFor({ limiter: fake.limiter })))).toBe(
    'FORBIDDEN',
  );
  expect(fake.calls).toEqual([]);
});

it('the staff branch accepts a revoked device credential and never reads it', async () => {
  const fake = fakeLimiter(true);
  const { request, reads } = requestWith({
    origin: STAFF_ORIGIN,
    authorization: 'Device revoked',
  });
  await expect(
    signOutRequest(request, 'staff', wiringFor({ limiter: fake.limiter })),
  ).resolves.toBe(true);
  expect(reads).not.toContain('authorization');
  expect(fake.calls).toHaveLength(1);
});

it('the personal branch refuses any authorization header', async () => {
  const fake = fakeLimiter(true);
  const { request } = requestWith({ origin: PERSONAL_ORIGIN, authorization: 'Device revoked' });
  expect(
    await codeOf(signOutRequest(request, 'personal', wiringFor({ limiter: fake.limiter }))),
  ).toBe('FORBIDDEN');
  expect(fake.calls).toEqual([]);
});

it('a refused request never reaches the limiter', async () => {
  const fake = fakeLimiter(true);
  const { request } = requestWith({ origin: PERSONAL_ORIGIN, authorization: 'Device revoked' });
  await codeOf(signOutRequest(request, 'personal', wiringFor({ limiter: fake.limiter })));
  expect(fake.calls).toEqual([]);
});

it('the limiter refuses the thirty-first request with too many requests', async () => {
  const fake = fakeLimiter(false);
  const { request } = requestWith({ origin: STAFF_ORIGIN });
  expect(await codeOf(signOutRequest(request, 'staff', wiringFor({ limiter: fake.limiter })))).toBe(
    'TOO_MANY_REQUESTS',
  );
});

it('each route counts its own window per IP', async () => {
  const staff = fakeLimiter(true);
  const { request: staffRequest } = requestWith({ origin: STAFF_ORIGIN });
  await signOutRequest(staffRequest, 'staff', wiringFor({ limiter: staff.limiter }));
  expect(staff.calls).toEqual([{ key: 'sign-out:staff:10.0.0.9', limit: 30, window: 60 }]);
  const personal = fakeLimiter(true);
  const { request: personalRequest } = requestWith({ origin: PERSONAL_ORIGIN });
  await signOutRequest(personalRequest, 'personal', wiringFor({ limiter: personal.limiter }));
  expect(personal.calls).toEqual([{ key: 'sign-out:personal:10.0.0.9', limit: 30, window: 60 }]);
});

it('SO-15b a passed sign-out leaves the request without a principal', async () => {
  const fake = fakeLimiter(true);
  const { request } = requestWith({ origin: STAFF_ORIGIN });
  await signOutRequest(request, 'staff', wiringFor({ limiter: fake.limiter }));
  expect(request.principal).toBeUndefined();
});

it('the sign-out decorator marks the handler it is put on', () => {
  const handler = () => undefined;
  SignOutRoute('personal')({}, 'signOut', { value: handler });
  expect(Reflect.getMetadata(SIGN_OUT_ROUTE, handler)).toBe('personal');
});

it('an API without the sign-out wiring answers not ready on both routes, never 401', async () => {
  const app = await createApp({ readiness: [] }, { logger: createLogger('silent') });
  try {
    for (const url of [
      '/v1/devices/me/staff-session/sign-out',
      '/v1/staff/personal-session/sign-out',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: { origin: 'https://wrong.synthetic.invalid' },
      });
      expect(response.statusCode).toBe(503);
      expect(errorEnvelope.parse(response.json()).code).toBe('NOT_READY');
    }
  } finally {
    await app.close();
  }
});
