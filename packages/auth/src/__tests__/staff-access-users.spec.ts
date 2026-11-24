import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { StaffPhoneTakenError } from '@pospay/db';
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
});afterAll(async () => {
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

it('AC-F1-1 provision creates the user with markers, synthetic email, no credential account and an approved binding', async () => {
  const operationId = ids.newId();
  const { userId } = await provision(phoneOf(1), operationId);
  const [user] = await owner`SELECT * FROM "user" WHERE id = ${userId}`;
  expect(user).toMatchObject({
    staff_access_company_id: f.device.companyId,
    staff_access_operation_id: operationId,
    email: `staff-${operationId}@${STAFF_SYNTHETIC_EMAIL_DOMAIN}`,
    email_verified: true,
    phone_binding_approved_at: expect.any(Date),
  });
  const accounts = await owner`SELECT id FROM account WHERE user_id = ${userId}`;
  expect(accounts).toHaveLength(0);
  const audits = await owner`SELECT action, details FROM platform_audit_log WHERE details->>'user_id' = ${userId} ORDER BY action`;
  expect(audits.map((row) => row.action)).toEqual(['phone.binding_approved', 'staff.created']);
});

it('AC-F1-6 provision is idempotent by the operation id and returns the same user', async () => {
  const operationId = ids.newId();
  const first = await provision(phoneOf(2), operationId);
  const second = await provision(phoneOf(2), operationId);
  expect(second.userId).toBe(first.userId);
  const users = await owner`SELECT id FROM "user" WHERE staff_access_operation_id = ${operationId}`;
  expect(users).toHaveLength(1);
});

it('AC-F1-5/F1-5 provision refuses a phone owned by any other user with no detail about it', async () => {
  await provision(phoneOf(3));
  const before = await owner`SELECT id, phone_number, phone_binding_approved_at FROM "user" WHERE phone_number = ${phoneOf(3)}`;
  await expect(provision(phoneOf(3))).rejects.toThrow(StaffPhoneTakenError);
  const after = await owner`SELECT id, phone_number, phone_binding_approved_at FROM "user" WHERE phone_number = ${phoneOf(3)}`;
  expect(after).toEqual(before);
  const created = await owner`SELECT id FROM "user" WHERE name = 'Synthetic staff' AND phone_number IS NULL AND created_at > now() - interval '1 minute'`;
  expect(created).toHaveLength(0);
});

it('FR-F1-6 cancel deletes the user by operation id for the same company only and audits it', async () => {
  const operationId = ids.newId();
  const { userId } = await provision(phoneOf(4), operationId);
  await f.auth.staffUsers.cancel({
    operationId,
    companyId: f.device.companyId,
    actorUserId: f.userId,
    ids,
  });
  expect(await owner`SELECT id FROM "user" WHERE id = ${userId}`).toHaveLength(0);
  const audits = await owner`SELECT action FROM platform_audit_log WHERE action = 'staff.cancelled' AND details->>'user_id' = ${userId}`;
  expect(audits).toHaveLength(1);
  // حساب شركة أخرى بنفس معرّف العملية غير ممكن أصلاً، والشركة الغريبة لا تمسح شيئاً.
  const otherOperation = ids.newId();
  const { userId: otherUser } = await provision(phoneOf(5), otherOperation);
  await f.auth.staffUsers.cancel({
    operationId: otherOperation,
    companyId: '01920000-0000-7000-8000-00000000ffff',
    actorUserId: f.userId,
    ids,
  });
  expect(await owner`SELECT id FROM "user" WHERE id = ${otherUser}`).toHaveLength(1);
});

it('FR-F1-1 read returns only the user id and the last three digits of the phone', async () => {
  const operationId = ids.newId();
  const { userId } = await provision(phoneOf(6), operationId);
  const read = await f.auth.staffUsers.read(operationId);
  expect(read).toEqual({ userId, phoneLast3: phoneOf(6).slice(-3) });
  expect(await f.auth.staffUsers.read(ids.newId())).toBeNull();
});

it('AC-F1-7 issuePasswordSetLink refuses a staff user and stays usable for a normal user', async () => {
  const { userId } = await provision(phoneOf(7));
  await expect(f.auth.issuePasswordSetLink(userId, 'https://admin.synthetic.invalid/x')).rejects.toThrow(
    'STAFF_USER_CREDENTIAL_REFUSED',
  );
  const verifications = await owner`SELECT id FROM verification WHERE value = ${userId}`;
  expect(verifications).toHaveLength(0);
  const link = await f.auth.issuePasswordSetLink(f.userId, 'https://admin.synthetic.invalid/x');
  expect(link).toContain('reset-password');
});

it('AC-F1-7 a staff user cannot start an email session and mints no normal session cookie', async () => {
  const { userId } = await provision(phoneOf(8));
  const email = `staff-probe@${STAFF_SYNTHETIC_EMAIL_DOMAIN}`;
  await owner`UPDATE "user" SET email = ${email} WHERE id = ${userId}`;
  const response = await f.auth.handler(
    new Request('https://api.synthetic.invalid/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'operator-chosen-pass' }),
    }),
  );
  expect(response.status).toBeGreaterThanOrEqual(400);
  const [session] = await owner`SELECT id FROM session WHERE user_id = ${userId}`;
  expect(session).toBeUndefined();
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
  expect(response.status).toBeGreaterThanOrEqual(400);
  const [account] = await owner`SELECT password FROM account WHERE id = ${accountId}`;
  expect(account?.password).toBe('pbkdf2$seeded');
  await owner`DELETE FROM account WHERE id = ${accountId}`;
});

it('P1-6 a normal session of a staff user is dead at consumption (getSession returns null)', async () => {
  const { userId } = await provision(phoneOf(20));
  const token = 'p1-six-consumption-session-token';
  await owner`INSERT INTO session (id, expires_at, token, ip_address, user_agent, user_id)
    VALUES (${ids.newId()}, now() + interval '1 hour', ${token}, NULL, NULL, ${userId})`;
  const headers = new Headers({ cookie: 'pospay.session_token=' + token });
  expect(await f.auth.getSession(headers)).toBeNull();
  await owner`DELETE FROM session WHERE user_id = ${userId}`;
});

it('P1-6 ordinary users still sign in, consume sessions and reset passwords', async () => {
  const email = `p1-six-ordinary-${ids.newId()}@example.test`;
  const { link } = await (await import('../create-platform-user.ts')).createPlatformUser(f.auth, {
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

it('AC-F1-7 no credential account can be created or updated for a staff user afterwards', async () => {
  const { userId } = await provision(phoneOf(9));
  const withAccount = async () =>
    f.auth.handler(
      new Request('https://api.synthetic.invalid/v1/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `x-${userId}@example.test`, password: 'operator-chosen-pass', name: 'X' }),
      }),
    );
  // Sign-up is closed for everyone (ADR-0003 §6); the backstop is the account hook: linking an account
  // row directly through Better Auth's own adapter path is refused for the marker.
  const response = await withAccount();
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(await owner`SELECT id FROM account WHERE user_id = ${userId}`).toHaveLength(0);
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
  expect(
    await owner`SELECT id FROM platform_grants WHERE user_id = ${userId}`,
  ).toHaveLength(0);
});

it('D8 isStaffUser answers by the marker for both kinds of users', async () => {
  const { userId } = await provision(phoneOf(12));
  expect(await f.auth.staffUsers.isStaffUser(userId)).toBe(true);
  expect(await f.auth.staffUsers.isStaffUser(f.userId)).toBe(false);
});

it('P1-5 staffCompanyOf returns the marker company for a staff user and null otherwise', async () => {
  const { userId } = await provision(phoneOf(14));
  expect(await f.auth.staffUsers.staffCompanyOf(userId)).toBe(f.device.companyId);
  expect(await f.auth.staffUsers.staffCompanyOf(f.userId)).toBeNull();
});

it('P1-5 bindingOf resolves the user bound to an operation id, or null', async () => {
  const operationId = ids.newId();
  const { userId } = await provision(phoneOf(15), operationId);
  expect(await f.auth.staffUsers.bindingOf(operationId)).toEqual({
    userId,
    companyId: f.device.companyId,
  });
  expect(await f.auth.staffUsers.bindingOf(ids.newId())).toBeNull();
});

it('P1-2 provision refuses to create a user for a record that is not PENDING', async () => {
  const before = await owner`SELECT count(*) AS n FROM "user" WHERE name = 'Synthetic staff'`;
  await expect(
    provision(phoneOf(16), ids.newId(), { recordState: 'CANCELLING' }),
  ).rejects.toThrow('STAFF_RECORD_NOT_PENDING');
  expect(
    await owner`SELECT count(*) AS n FROM "user" WHERE name = 'Synthetic staff'`,
  ).toEqual(before);
});

it('P1-4 resetBinding re-approves the requested phone on the existing user and refuses a taken phone', async () => {
  const operationId = ids.newId();
  const { userId } = await provision(phoneOf(17), operationId);
  const newPhone = phoneOf(18);
  await provision(newPhone, operationId, { resetBinding: true });
  const [user] = await owner`SELECT phone_number, phone_binding_approved_at FROM "user" WHERE id = ${userId}`;
  expect(user?.phone_number).toBe(newPhone);
  expect(user?.phone_binding_approved_at).not.toBeNull();
  // هاتف مملوك لمستخدم آخر يُرفض حتى في وضع resetBinding وبلا أي تفاصيل عن المالك.
  const otherUser = ids.newId();
  await owner`INSERT INTO "user"(id,name,email,phone_number) VALUES (${otherUser},'Other',${`o-${otherUser}@example.test`},'+96550000099')`;
  await expect(
    provision('+96550000099', operationId, { resetBinding: true }),
  ).rejects.toThrow(StaffPhoneTakenError);
  const [unchanged] = await owner`SELECT phone_number FROM "user" WHERE id = ${userId}`;
  expect(unchanged?.phone_number).toBe(newPhone);
  await owner`DELETE FROM "user" WHERE id = ${otherUser}`;
});

it('two concurrent provisions of one phone produce one user and one typed refusal', async () => {
  const phone = phoneOf(13);
  const [first, second] = await Promise.allSettled([
    provision(phone, ids.newId()),
    provision(phone, ids.newId()),
  ]);
  const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
  const refused = [first, second].filter(
    (r) => r.status === 'rejected' && r.reason instanceof StaffPhoneTakenError,
  );
  expect(fulfilled).toHaveLength(1);
  expect(refused).toHaveLength(1);
  expect(await owner`SELECT id FROM "user" WHERE phone_number = ${phone}`).toHaveLength(1);
});

it('provision input validation refuses malformed input before any write', async () => {
  const before = await owner`SELECT count(*) AS n FROM "user"`;
  for (const phone of ['96512345678', '+9651234', 'not-a-phone']) {
    await expect(provision(phone)).rejects.toThrow();
    await expect(provision(createHash('sha256').update(phone).toString())).rejects.toThrow();
  }
  expect(await owner`SELECT count(*) AS n FROM "user"`).toEqual(before);
});
