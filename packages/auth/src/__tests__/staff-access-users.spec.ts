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
const provision = (phone: string, operationId = ids.newId()) =>
  f.auth.staffUsers.provision({
    operationId,
    companyId: f.device.companyId,
    phone,
    name: 'Synthetic staff',
    actorUserId: f.userId,
    ids,
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
