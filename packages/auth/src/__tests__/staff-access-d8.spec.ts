import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAuthDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { buildBetterAuth } from '../config.ts';
import { sessionCookieNames } from '../session-cookie.ts';
import { staffAuthFixture, type StaffAuthFixture } from './staff-auth.fixture.ts';
const ids = systemUuidV7();
let f: StaffAuthFixture;
beforeAll(async () => {
  f = await staffAuthFixture();
});
afterAll(async () => {
  await f?.close();
});
const password = 'synthetic'.repeat(8);
const request = (route: string, body: unknown, cookie?: string) =>
  new Request('https://api.synthetic.invalid/v1/auth/' + route, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://admin.synthetic.invalid',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
async function ordinary() {
  const email = `${ids.newId()}@example.test`;
  const userId = await f.auth.provisionUser({ email, name: 'D8 target', password });
  const response = await f.auth.handler(request('sign-in/email', { email, password }));
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  expect((await f.auth.getSession(new Headers({ cookie })))?.userId).toBe(userId);
  return { userId, email, cookie };
}
async function markStaff(userId: string) {
  await f.owner`UPDATE "user" SET staff_access_company_id=${f.device.companyId},staff_access_operation_id=${ids.newId()} WHERE id=${userId}`;
}
it('P1-6 valid credential sign-in reaches the session issue hook and refuses a marked staff user', async () => {
  const user = await ordinary();
  await markStaff(user.userId);
  await f.owner`DELETE FROM session WHERE user_id=${user.userId}`;
  const response = await f.auth.handler(request('sign-in/email', { email: user.email, password }));
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.headers.getSetCookie().join(' ')).not.toContain('session_token=');
  expect(await f.owner`SELECT id FROM session WHERE user_id=${user.userId}`).toHaveLength(0);
});
it('P1-6 signed live normal session is refused at consumption and cannot enable 2FA for a staff user', async () => {
  const user = await ordinary();
  await markStaff(user.userId);
  expect(await f.auth.getSession(new Headers({ cookie: user.cookie }))).toBeNull();
  const response = await f.auth.handler(request('two-factor/enable', { password }, user.cookie));
  expect(response.status).toBe(403);
  expect(await f.owner`SELECT id FROM two_factor WHERE user_id=${user.userId}`).toHaveLength(0);
});
it('P1-6 Better Auth real account update with only password checks the target row', async () => {
  const user = await ordinary();
  await markStaff(user.userId);
  const database = createAuthDatabase({ url: f.test.authUrl });
  const options = {
    databaseUrl: f.test.authUrl,
    staffPhoneLockKey: () => 1n,
    secret: 'synthetic'.repeat(8),
    baseURL: 'https://api.synthetic.invalid',
    trustedOrigins: ['https://admin.synthetic.invalid'],
    ids,
    secureCookies: true,
    cookieDomain: '.synthetic.invalid',
    onLog: () => undefined,
  };
  try {
    const auth = buildBetterAuth(options, database, f.auth.staffUsers, sessionCookieNames(options));
    const context = await auth.$context;
    const [account] = await f.owner`SELECT id,password FROM account WHERE user_id=${user.userId}`;
    await expect(
      context.internalAdapter.updateAccount(account?.id, { password: 'replacement-hash' }),
    ).rejects.toThrow('STAFF_USER_CREDENTIAL_REFUSED');
    expect(await f.owner`SELECT password FROM account WHERE id=${account?.id}`).toEqual([
      { password: account?.password },
    ]);
    await expect(
      context.internalAdapter.linkAccount({
        userId: user.userId,
        providerId: 'credential',
        accountId: user.userId,
        password: 'new-hash',
      }),
    ).rejects.toThrow('STAFF_USER_CREDENTIAL_REFUSED');
  } finally {
    await database.close();
  }
});

it('P1-6 two-factor enabling is independently refused for a marked user with a valid password and signed cookie', async () => {
  const user = await ordinary();
  await markStaff(user.userId);
  const response = await f.auth.handler(request('two-factor/enable', { password }, user.cookie));
  expect(response.status).toBe(403);
  expect(await f.owner`SELECT id FROM two_factor WHERE user_id=${user.userId}`).toHaveLength(0);
});
