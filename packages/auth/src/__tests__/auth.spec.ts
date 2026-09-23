import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createUuidV7, systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../../db/test/test-database.ts';
import {
  grantPlatformPermission,
  revokePlatformPermission,
} from '../../../db/src/platform-grants.ts';
import { seedReferenceData } from '../../../db/src/seed.ts';
import {
  createAuth,
  OperatorInputError,
  createPlatformUser,
  type AuthLogEntry,
  type AuthOptions,
  type AuthService,
} from '../index.ts';

// T9a-1: a real login produces a session, on pospay_auth, with sign-up closed and nothing stored in clear.
const BASE = 'http://api.test';
const ORIGIN = 'http://admin.test';
const PASSWORD = 'correct-horse-battery';
let testDb: TestDatabase;
let auth: AuthService;
let owner: postgres.Sql;
const logged: AuthLogEntry[] = [];

const optionsFor = (databaseUrl: string): AuthOptions => ({
  databaseUrl,
  secret: 'test-secret-that-is-long-enough-for-hmac',
  baseURL: BASE,
  trustedOrigins: [ORIGIN],
  ids: systemUuidV7(),
  secureCookies: false,
  onLog: (entry) => logged.push(entry),
});

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedReferenceData(testDb.ownerUrl);
  auth = await createAuth(optionsFor(testDb.authUrl));
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
  it('answers as pospay_auth, and refuses to start on any other role — the owner included', async () => {
    await expect(auth.ping()).resolves.toBeUndefined();
    await expect(createAuth(optionsFor(testDb.appUrl))).rejects.toThrow(
      /must connect as pospay_auth/,
    );
    await expect(createAuth(optionsFor(testDb.ownerUrl))).rejects.toThrow(
      /must connect as pospay_auth/,
    );
  });

  it('refuses a secret too short to sign cookies', async () => {
    const ids = createUuidV7({ now: () => 1, fillRandom: () => undefined });
    await expect(
      createAuth({ ...optionsFor(testDb.authUrl), secret: 'short', ids }),
    ).rejects.toThrow(/at least 32/);
  });
});

describe('session renewal and library logging', () => {
  it('logs a rejected callback by its phrase only — never the URL or a short secret in it', async () => {
    await auth.provisionUser({ email: 'cb@example.test', name: 'Cb', password: PASSWORD });
    logged.length = 0;
    const response = await post('/sign-in/email', {
      email: 'cb@example.test',
      password: PASSWORD,
      callbackURL: '//bad.test/?otp=123456',
    });
    expect(response.status).toBe(403);
    expect(logged).toContainEqual(expect.objectContaining({ message: 'Invalid callbackURL' }));
    expect(JSON.stringify(logged)).not.toMatch(/123456|bad\.test/);
  });

  const signedIn = async (email: string): Promise<string> => {
    await auth.provisionUser({ email, name: 'Renew', password: PASSWORD });
    return cookieOf(await post('/sign-in/email', { email, password: PASSWORD }));
  };

  it('returns the renewed cookie once the session is old enough to be extended', async () => {
    const cookie = await signedIn('renew@example.test');
    expect((await auth.getSession(new Headers({ cookie })))?.setCookies).toEqual([]);
    await owner`UPDATE session SET expires_at = now() + interval '5 days'`;
    const renewed = await auth.getSession(new Headers({ cookie }));
    expect(renewed?.setCookies.some((c) => c.startsWith('pospay.session_token='))).toBe(true);
  });

  it('a database failure reaches onLog without the token, and nothing goes to the console', async () => {
    const cookie = await signedIn('leak@example.test');
    const token = /pospay\.session_token=([^.;]+)/.exec(cookie)?.[1] ?? '';
    expect(token).not.toBe('');
    const consoles = (['log', 'warn', 'error', 'info', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    logged.length = 0;
    await owner`REVOKE SELECT ON session FROM pospay_auth`;
    try {
      await expect(auth.getSession(new Headers({ cookie }))).rejects.toThrow();
      // Checked before mockRestore, which clears what the spies recorded.
      consoles.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    } finally {
      await owner`GRANT SELECT ON session TO pospay_auth`;
      consoles.forEach((spy) => spy.mockRestore());
    }
    expect(logged).toContainEqual(
      expect.objectContaining({ level: 'error', message: 'INTERNAL_SERVER_ERROR' }),
    );
    expect(JSON.stringify(logged)).not.toContain(token);
  });
});

describe('platform:create-user and platform grants (T9a-3)', () => {
  const grant = {
    email: 'op@example.test',
    permission: 'create:companies:platform',
    operator: 'waleed',
  };

  it('creates a user with an audit row and a one-time link that sets the password', async () => {
    const { userId, link } = await createPlatformUser(auth, {
      email: grant.email,
      name: 'Operator',
      operator: 'waleed',
      redirectTo: `${ORIGIN}/set-password`,
    });
    const [audit] = await owner`SELECT actor, action, target_user_id FROM platform_audit_log`;
    expect(audit).toEqual({ actor: 'waleed', action: 'user.created', target_user_id: userId });
    const token = new URL(link).pathname.split('/').pop() ?? '';
    const reset = () => post('/reset-password', { token, newPassword: 'operator-chosen-pass' });
    expect((await reset()).status).toBe(200);
    expect((await reset()).status).toBe(400);
    expect(
      (await post('/sign-in/email', { email: grant.email, password: 'operator-chosen-pass' }))
        .status,
    ).toBe(200);
  });

  it("a session carries the user's active platform grants — and loses them when revoked", async () => {
    const cookie = cookieOf(
      await post('/sign-in/email', { email: grant.email, password: 'operator-chosen-pass' }),
    );
    expect((await auth.getSession(new Headers({ cookie })))?.platformPermissions).toEqual([]);
    await grantPlatformPermission(testDb.ownerUrl, grant, systemUuidV7());
    expect((await auth.getSession(new Headers({ cookie })))?.platformPermissions).toEqual([
      'create:companies:platform',
    ]);
    await revokePlatformPermission(testDb.ownerUrl, grant, systemUuidV7());
    expect((await auth.getSession(new Headers({ cookie })))?.platformPermissions).toEqual([]);
  });
});

describe('platform:create-user failures leave nothing half-done and leak nothing', () => {
  const input = (email: string) => ({
    email,
    name: 'Half',
    operator: 'waleed',
    redirectTo: `${ORIGIN}/set-password`,
  });
  const userCount = async (email: string) =>
    (await owner`SELECT count(*)::int AS n FROM "user" WHERE email = ${email}`)[0]?.['n'];

  it('refuses bad input before writing anything', async () => {
    await expect(
      createPlatformUser(auth, { ...input('bad@example.test'), operator: ' ' }),
    ).rejects.toBeInstanceOf(OperatorInputError);
    expect(await userCount('bad@example.test')).toBe(0);
  });

  it('removes the new user when its audit row cannot be written', async () => {
    await owner`REVOKE INSERT ON platform_audit_log FROM pospay_auth`;
    try {
      await expect(createPlatformUser(auth, input('half@example.test'))).rejects.toThrow();
    } finally {
      await owner`GRANT INSERT ON platform_audit_log TO pospay_auth`;
    }
    expect(await userCount('half@example.test')).toBe(0);
  });

  it('the script reports a database failure by class and code only — no query, no email, no hash', () => {
    const run = () =>
      spawnSync(
        process.execPath,
        [
          'scripts/create-user.ts',
          '--email',
          'twice@example.test',
          '--name',
          'Twice',
          '--operator',
          'waleed',
          '--redirect-to',
          `${ORIGIN}/set-password`,
        ],
        {
          cwd: fileURLToPath(new URL('../..', import.meta.url)),
          encoding: 'utf8',
          env: {
            ...process.env,
            AUTH_DATABASE_URL: testDb.authUrl,
            BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-hmac',
            BETTER_AUTH_URL: BASE,
            AUTH_TRUSTED_ORIGINS: ORIGIN,
          },
        },
      );
    expect(run().status).toBe(0);
    const second = run();
    expect(second.status).toBe(1);
    expect(second.stderr).toMatch(/platform:create-user failed:/);
    expect(second.stderr).not.toMatch(
      /twice@example\.test|Failed query|\$argon|\$scrypt|insert into/i,
    );
  });
});
