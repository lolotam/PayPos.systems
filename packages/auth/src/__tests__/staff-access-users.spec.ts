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
  const audits =
    await owner`SELECT action, details FROM platform_audit_log WHERE details->>'user_id' = ${userId} ORDER BY action`;
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
  const before =
    await owner`SELECT id, phone_number, phone_binding_approved_at FROM "user" WHERE phone_number = ${phoneOf(3)}`;
  await expect(provision(phoneOf(3))).rejects.toThrow(StaffPhoneTakenError);
  const after =
    await owner`SELECT id, phone_number, phone_binding_approved_at FROM "user" WHERE phone_number = ${phoneOf(3)}`;
  expect(after).toEqual(before);
  const created =
    await owner`SELECT id FROM "user" WHERE name = 'Synthetic staff' AND phone_number IS NULL AND created_at > now() - interval '1 minute'`;
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
  const audits =
    await owner`SELECT action FROM platform_audit_log WHERE action = 'staff.cancelled' AND details->>'user_id' = ${userId}`;
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
  await expect(provision(phoneOf(16), ids.newId(), { recordState: 'CANCELLING' })).rejects.toThrow(
    'STAFF_RECORD_NOT_PENDING',
  );
  expect(await owner`SELECT count(*) AS n FROM "user" WHERE name = 'Synthetic staff'`).toEqual(
    before,
  );
});

it('P1-4 resetBinding re-approves the requested phone on the existing user and refuses a taken phone', async () => {
  const operationId = ids.newId();
  const { userId } = await provision(phoneOf(17), operationId);
  const newPhone = phoneOf(18);
  await provision(newPhone, operationId, { resetBinding: true });
  const [user] =
    await owner`SELECT phone_number, phone_binding_approved_at FROM "user" WHERE id = ${userId}`;
  expect(user?.phone_number).toBe(newPhone);
  expect(user?.phone_binding_approved_at).not.toBeNull();
  // هاتف مملوك لمستخدم آخر يُرفض حتى في وضع resetBinding وبلا أي تفاصيل عن المالك.
  const otherUser = ids.newId();
  await owner`INSERT INTO "user"(id,name,email,phone_number) VALUES (${otherUser},'Other',${`o-${otherUser}@example.test`},'+96550000099')`;
  await expect(provision('+96550000099', operationId, { resetBinding: true })).rejects.toThrow(
    StaffPhoneTakenError,
  );
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

it.each(['CANCELLING', 'phone', 'company'] as const)(
  'P1-2/P1-4 existing operation refuses %s mismatch without changing its binding',
  async (mismatch) => {
    const operationId = ids.newId();
    const phone = phoneOf(30 + ['CANCELLING', 'phone', 'company'].indexOf(mismatch));
    const { userId } = await provision(phone, operationId);
    const before =
      await owner`SELECT id,phone_number,staff_access_company_id FROM "user" WHERE id=${userId}`;
    await expect(
      f.auth.staffUsers.provision({
        operationId,
        companyId: mismatch === 'company' ? ids.newId() : f.device.companyId,
        phone: mismatch === 'phone' ? phoneOf(60) : phone,
        name: 'Existing operation',
        actorUserId: f.userId,
        ids,
        recordState: mismatch === 'CANCELLING' ? 'CANCELLING' : 'PENDING',
        resetBinding: false,
      }),
    ).rejects.toThrow('STAFF_RECORD_NOT_PENDING');
    expect(
      await owner`SELECT id,phone_number,staff_access_company_id FROM "user" WHERE id=${userId}`,
    ).toEqual(before);
  },
);
