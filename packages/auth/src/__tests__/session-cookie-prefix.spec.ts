import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';

import { createTestDatabase, type TestDatabase } from '../../../db/test/test-database.ts';
import { phoneLockKey } from '../../../notifications/src/phone-identity.ts';
import { createAuth, type AuthService } from '../index.ts';

// The environment prefix: a session cookie from another environment must never be a session here.
const BASE = 'http://api.test';
const ORIGIN = 'http://admin.test';
const PASSWORD = 'operator-chosen-pass';
const EMAIL = 'prefix@example.test';

let test: TestDatabase;
let auth: AuthService;
let userId: string;

beforeAll(async () => {
  test = await createTestDatabase();
  auth = await createAuth({
    databaseUrl: test.authUrl,
    staffPhoneLockKey: phoneLockKey,
    secret: 'test-secret-that-is-long-enough-for-hmac',
    baseURL: BASE,
    trustedOrigins: [ORIGIN],
    ids: systemUuidV7(),
    secureCookies: false,
    cookiePrefix: 'pospay-stg',
    onLog: () => undefined,
  });
  userId = await auth.provisionUser({ email: EMAIL, name: 'Prefix', password: PASSWORD });
});

afterAll(async () => {
  await auth?.close();
  await test?.drop();
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
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

describe('a session cookie prefixed by its environment', () => {
  it('signs in under this environment name and reads nothing under the other one', async () => {
    const cookie = cookieOf(await post('/sign-in/email', { email: EMAIL, password: PASSWORD }));
    expect(cookie).toContain('pospay-stg.session_token=');
    expect(cookie).not.toContain('pospay.session_token=');
    expect((await auth.getSession(new Headers({ cookie })))?.userId).toBe(userId);
    const other = cookie.replace('pospay-stg.session_token', 'pospay.session_token');
    expect(await auth.getSession(new Headers({ cookie: other }))).toBeNull();
  });

  it('signs out under this environment name', async () => {
    const cookie = cookieOf(await post('/sign-in/email', { email: EMAIL, password: PASSWORD }));
    const signOut = await post('/sign-out', {}, cookie);
    expect(signOut.status).toBe(200);
    expect(cookieOf(signOut)).toContain('pospay-stg.session_token=');
    expect(await auth.getSession(new Headers({ cookie }))).toBeNull();
  });

  it('leaves the staff and the personal cookie under their own names', async () => {
    const ids = systemUuidV7();
    const staff = await auth.staff.issue(
      userId,
      {
        companyId: ids.newId(),
        businessId: ids.newId(),
        branchId: ids.newId(),
        deviceId: ids.newId(),
      },
      async () => true,
    );
    expect(staff.cookie).toContain('pospay-staff.session_token=');
    const personal = await auth.personal.issue(
      userId,
      { purpose: 'STAFF_PERSONAL', companyId: ids.newId(), businessId: ids.newId() },
      async () => true,
    );
    expect(personal.cookie).toContain('pospay-personal.session_token=');
  });
});
