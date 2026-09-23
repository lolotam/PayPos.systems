import { createUuidV7, systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../../db/test/test-database.ts';
import { createAuth, type AuthService } from '../index.ts';

// T9a-1: a real login produces a session, on pospay_auth, with sign-up closed and nothing stored in clear.
const BASE = 'http://api.test';
const ORIGIN = 'http://admin.test';
const PASSWORD = 'correct-horse-battery';
let testDb: TestDatabase;
let auth: AuthService;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  auth = createAuth({
    databaseUrl: testDb.authUrl,
    secret: 'test-secret-that-is-long-enough-for-hmac',
    baseURL: BASE,
    trustedOrigins: [ORIGIN],
    ids: systemUuidV7(),
    secureCookies: false,
  });
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await auth.close();
  await owner.end();
  await testDb.drop();
});

const post = (path: string, body: unknown, cookie?: string) =>
  auth.handler(
    new Request(`${BASE}/v1/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        ...(cookie === undefined ? {} : { cookie }),
      },
      body: JSON.stringify(body),
    }),
  );
const cookieOf = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

describe('provisioning', () => {
  it('stores a hash, never the password, under a UUID v7 id', async () => {
    const id = await auth.provisionUser({
      email: 'Owner@Example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    const [row] = await owner`
      SELECT u.email, a.password FROM "user" u JOIN account a ON a.user_id = u.id WHERE u.id = ${id}`;
    expect(row?.['email']).toBe('owner@example.test');
    expect(String(row?.['password'])).not.toContain(PASSWORD);
  });

  it('keeps sign-up closed — users come only from the operator path', async () => {
    const response = await post('/sign-up/email', {
      email: 'x@example.test',
      name: 'X',
      password: PASSWORD,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await owner`SELECT 1 FROM "user" WHERE email = 'x@example.test'`).toHaveLength(0);
  });
});

describe('login', () => {
  it('a real login produces a session that getSession verifies, and sign-out ends it', async () => {
    const id = await auth.provisionUser({
      email: 'login@example.test',
      name: 'Login',
      password: PASSWORD,
    });
    const signIn = await post('/sign-in/email', {
      email: 'login@example.test',
      password: PASSWORD,
    });
    expect(signIn.status).toBe(200);
    const cookie = cookieOf(signIn);
    expect(cookie).toContain('pospay.session_token=');
    const session = await auth.getSession(new Headers({ cookie }));
    expect(session?.userId).toBe(id);
    expect((await post('/sign-out', {}, cookie)).status).toBe(200);
    expect(await auth.getSession(new Headers({ cookie }))).toBeNull();
  });

  it('a wrong password is refused and sets no session', async () => {
    await auth.provisionUser({ email: 'wrong@example.test', name: 'Wrong', password: PASSWORD });
    const response = await post('/sign-in/email', {
      email: 'wrong@example.test',
      password: 'not-the-password',
    });
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('a forged or missing cookie is no session', async () => {
    expect(await auth.getSession(new Headers())).toBeNull();
    expect(
      await auth.getSession(new Headers({ cookie: 'pospay.session_token=forged.value' })),
    ).toBeNull();
  });
});

describe('the auth database', () => {
  it('answers as pospay_auth, and an auth service on another role is not ready', async () => {
    await expect(auth.ping()).resolves.toBeUndefined();
    const wrong = createAuth({
      databaseUrl: testDb.appUrl,
      secret: 'test-secret-that-is-long-enough-for-hmac',
      baseURL: BASE,
      trustedOrigins: [],
      ids: systemUuidV7(),
      secureCookies: false,
    });
    try {
      await expect(wrong.ping()).rejects.toThrow(/must connect as pospay_auth/);
    } finally {
      await wrong.close();
    }
  });

  it('refuses a secret too short to sign cookies', () => {
    const ids = createUuidV7({ now: () => 1, fillRandom: () => undefined });
    expect(() =>
      createAuth({
        databaseUrl: testDb.authUrl,
        secret: 'short',
        baseURL: BASE,
        trustedOrigins: [],
        ids,
        secureCookies: false,
      }),
    ).toThrow(/at least 32/);
  });
});
