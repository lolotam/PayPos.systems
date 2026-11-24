import type postgres from 'postgres';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { STAFF_SYNTHETIC_EMAIL_DOMAIN } from '../staff-access-users.ts';
import { staffAuthFixture, type StaffAuthFixture } from './staff-auth.fixture.ts';

let f: StaffAuthFixture;
let owner: postgres.Sql;
const ids = systemUuidV7();
beforeAll(async () => {
  f = await staffAuthFixture();
  owner = f.owner;
});
afterAll(async () => {
  await f?.close();
});

const phoneOf = (n: number) => `+965500000${String(n).padStart(2, '0')}`;
const provision = (
  phone: string,
  operationId = ids.newId(),
  options: { recordState?: 'PENDING' | 'CANCELLING'; resetBinding?: boolean } = {},
) =>
  f.auth.staffUsers.provision({
    operationId,
    companyId: f.device.companyId,
    phone,
    name: 'Synthetic staff',
    actorUserId: f.userId,
    ids,
    recordState: options.recordState ?? 'PENDING',
    resetBinding: options.resetBinding ?? false,
  });

it('AC-F1-7 issuePasswordSetLink refuses a staff user and stays usable for a normal user', async () => {
  const { userId } = await provision(phoneOf(7));
  await expect(
    f.auth.issuePasswordSetLink(userId, 'https://admin.synthetic.invalid/x'),
  ).rejects.toThrow('STAFF_USER_CREDENTIAL_REFUSED');
  const verifications = await owner`SELECT id FROM verification WHERE value = ${userId}`;
  expect(verifications).toHaveLength(0);
  const link = await f.auth.issuePasswordSetLink(f.userId, 'https://admin.synthetic.invalid/x');
  expect(link).toContain('reset-password');
});

it('P1-6 reset-password consumption refuses a credential account of a staff user (target check)', async () => {
  const { userId } = await provision(phoneOf(19));
  // حساب credential مزروع يدوياً: الاستهلاك (وليس الإصدار) هو المسار المطلوب إقفاله (P1-6).
  const accountId = ids.newId();
  await owner`INSERT INTO account (id, account_id, provider_id, user_id, password)
    VALUES (${accountId}, ${userId}, 'credential', ${userId}, 'pbkdf2$seeded')`;
  const token = 'p1-six-staff-reset-token';
  await owner`INSERT INTO verification (id, identifier, value, expires_at)
    VALUES (${ids.newId()}, ${`reset-password:${token}`}, ${userId}, now() + interval '1 hour')`;
  const response = await f.auth.handler(
    new Request('https://api.synthetic.invalid/v1/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'brand-new-pass-123' }),
    }),
  );
  // AC-ACT-18: نفس رد الرابط الميت بالضبط، لا رمز خاص بحسابات الموظفات.
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'INVALID_TOKEN', message: 'Invalid token' });
  const [account] = await owner`SELECT password FROM account WHERE id = ${accountId}`;
  expect(account?.password).toBe('pbkdf2$seeded');
  await owner`DELETE FROM account WHERE id = ${accountId}`;
});

it('P1-6 ordinary users still sign in, consume sessions and reset passwords', async () => {
  const email = `p1-six-ordinary-${ids.newId()}@example.test`;
  const { link } = await (
    await import('../create-platform-user.ts')
  ).createPlatformUser(f.auth, {
    email,
    name: 'Ordinary',
    operator: 'synthetic-operator',
    redirectTo: 'https://admin.synthetic.invalid/set-password',
  });
  const token = new URL(link).pathname.split('/').pop() ?? '';
  const reset = await f.auth.handler(
    new Request('https://api.synthetic.invalid/v1/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'operator-chosen-pass' }),
    }),
  );
  expect(reset.status).toBeLessThan(400);
  const signIn = await f.auth.handler(
    new Request('https://api.synthetic.invalid/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'operator-chosen-pass' }),
    }),
  );
  expect(signIn.status).toBeLessThan(400);
  const setCookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0];
  const [user] = await owner`SELECT id FROM "user" WHERE email = ${email}`;
  const consumed = await f.auth.getSession(new Headers({ cookie: setCookie }));
  expect(consumed?.userId).toBe(user?.id);
  // تفعيل TOTP عبر جلسة عادية يظل مسموحاً — مسار المستخدمين العاديين لا يتغير (P1-6 regression).
  const enable = await f.auth.handler(
    new Request('https://api.synthetic.invalid/v1/auth/two-factor/enable', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: setCookie,
        origin: 'https://admin.synthetic.invalid',
      },
      body: JSON.stringify({ password: 'operator-chosen-pass' }),
    }),
  );
  expect(enable.status).toBeLessThan(400);
  await owner`DELETE FROM two_factor WHERE user_id = ${user?.id}`;
  await owner`DELETE FROM session WHERE user_id = ${user?.id}`;
  await owner`DELETE FROM account WHERE user_id = ${user?.id}`;
  // تدقيق المنصة insert-only يشير بالمستخدم (target_user_id أو details): التنظيف يمسح المراجع أولاً.
  await owner`DELETE FROM platform_audit_log
    WHERE target_user_id = ${user?.id} OR details->>'user_id' = ${user?.id}`;
  await owner`DELETE FROM "user" WHERE id = ${user?.id}`;
});

it('AC-F1-7 createPlatformUser refuses the reserved domain and platform grants refuse the staff user', async () => {
  const { OperatorInputError } = await import('../create-platform-user.ts');
  const { createPlatformUser } = await import('../create-platform-user.ts');
  await expect(
    createPlatformUser(f.auth, {
      email: `someone@${STAFF_SYNTHETIC_EMAIL_DOMAIN}`,
      name: 'X',
      operator: 'synthetic-operator',
      redirectTo: 'https://admin.synthetic.invalid/set-password',
    }),
  ).rejects.toThrow(OperatorInputError);
  const { userId } = await provision(phoneOf(11));
  const email = `staff-grant@${STAFF_SYNTHETIC_EMAIL_DOMAIN}`;
  await owner`UPDATE "user" SET email = ${email} WHERE id = ${userId}`;
  const { grantPlatformPermission } = await import('@pospay/db');
  await expect(
    grantPlatformPermission(
      f.test.ownerUrl,
      { email, permission: 'create:companies:platform', operator: 'synthetic-operator' },
      ids,
    ),
  ).rejects.toThrow('platform grants are refused for a staff user');
  expect(await owner`SELECT id FROM platform_grants WHERE user_id = ${userId}`).toHaveLength(0);
});

it('D8 isStaffUser answers by the marker for both kinds of users', async () => {
  const { userId } = await provision(phoneOf(12));
  expect(await f.auth.staffUsers.isStaffUser(userId)).toBe(true);
  expect(await f.auth.staffUsers.isStaffUser(f.userId)).toBe(false);
});
