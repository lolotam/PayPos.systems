import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { attendanceFixture, type AttendanceFixture } from './clock-attendance.fixture.ts';
import { lockEmployee, prepareLockEnrol, PHONE_X, PHONE_Y } from './passkey-device-lock.fixture.ts';
import { installationHash } from '../persistence/attendance-device-signal.ts';

let f: AttendanceFixture;
beforeAll(async () => {
  f = await attendanceFixture();
  await (await f.prepare()).execute();
  await expect(
    f.challenge.execute(f.scope, { ...f.scan(), installation_id: PHONE_Y }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_DEVICE_NOT_ENROLLED' });
});
afterAll(async () => {
  await f?.close();
});

it('FORCE RLS hides another company and refuses cross-tenant inserts and tenant-qualified FKs', async () => {
  const [flags] =
    await f.owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='attendance_device_refusals'`;
  expect(flags).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  await f.database.withTenant(f.otherCompany, async (tx) => {
    expect(await tx.execute(sql`SELECT id FROM attendance_device_refusals`)).toHaveLength(0);
    expect(
      await tx.execute(
        sql`UPDATE employee_passkeys SET installation_hash=${installationHash(f.companyId, PHONE_X)},installation_locked_at=${f.clock.now().toISOString()}::timestamptz RETURNING id`,
      ),
    ).toHaveLength(0);
  });
  for (const companyId of [f.companyId, f.otherCompany])
    await expect(
      f.database.withTenant(f.otherCompany, (tx) =>
        tx.execute(sql`
      INSERT INTO attendance_device_refusals(company_id,id,business_id,branch_id,employee_id,step,reason,installation_hash,attempted_at)
      VALUES(${companyId},${f.ids.newId()},${f.businessId},${f.branchId},${f.employeeId},'CLOCK','NOT_ENROLLED',${'a'.repeat(64)},clock_timestamp())`),
      ),
    ).rejects.toThrow();
});

it('refusal rows cannot be updated or deleted and only the allowed binding columns are updatable', async () => {
  for (const statement of [
    sql`UPDATE attendance_device_refusals SET reason=reason`,
    sql`DELETE FROM attendance_device_refusals`,
    sql`UPDATE employee_passkeys SET passkey_id=passkey_id`,
  ])
    await expect(
      f.database.withTenant(f.companyId, (tx) => tx.execute(statement)),
    ).rejects.toThrow();
  await expect(
    f.database.withTenant(f.companyId, (tx) =>
      tx.execute(
        sql`UPDATE employee_passkeys SET installation_hash=${installationHash(f.companyId, PHONE_X)},installation_locked_at=installation_locked_at WHERE id=${f.bindingId}`,
      ),
    ),
  ).resolves.toBeDefined();
});

it.each([null, 'b'.repeat(64)])(
  'the set-once trigger rejects replacing the lock with %s',
  async (hash) => {
    await expect(
      f.database.withTenant(f.companyId, (tx) =>
        tx.execute(
          sql`UPDATE employee_passkeys SET installation_hash=${hash} WHERE id=${f.bindingId}`,
        ),
      ),
    ).rejects.toThrow();
  },
);

it.each([null, '2026-10-11T00:00:00.000Z'])(
  'the set-once trigger rejects changing the lock timestamp to %s',
  async (at) => {
    await expect(
      f.database.withTenant(f.companyId, (tx) =>
        tx.execute(sql`
      UPDATE employee_passkeys SET installation_locked_at=${at}::timestamptz WHERE id=${f.bindingId}`),
      ),
    ).rejects.toThrow();
  },
);

it('validated binding CHECKs require a hash/timestamp pair and reject invalid hashes', async () => {
  const person = await lockEmployee(f);
  const binding = await (await prepareLockEnrol(f, person)).execute();
  for (const [hash, at] of [
    ['a'.repeat(64), null],
    [null, '2026-10-10T12:00:00.000Z'],
    ['invalid', '2026-10-10T12:00:00.000Z'],
  ]) {
    await expect(
      f.database.withTenant(f.companyId, (tx) =>
        tx.execute(sql`
      UPDATE employee_passkeys SET installation_hash=${hash},installation_locked_at=${at}::timestamptz
      WHERE id=${binding.binding_id}`),
      ),
    ).rejects.toThrow();
  }
  expect(
    await f.owner`SELECT conname,convalidated FROM pg_constraint
    WHERE conrelid='employee_passkeys'::regclass AND conname LIKE 'employee_passkeys_installation_%'
    ORDER BY conname`,
  ).toEqual([
    { conname: 'employee_passkeys_installation_hash_format', convalidated: true },
    { conname: 'employee_passkeys_installation_lock_pair', convalidated: true },
  ]);
});

it('holder/reason and hash CHECKs reject invalid evidence', async () => {
  for (const [reason, holder, hash] of [
    ['DEVICE_LOCKED', null, 'a'.repeat(64)],
    ['NOT_ENROLLED', f.employeeId, 'a'.repeat(64)],
    ['NOT_ENROLLED', null, PHONE_X],
  ])
    await expect(
      f.database.withTenant(f.companyId, (tx) =>
        tx.execute(sql`
      INSERT INTO attendance_device_refusals(company_id,id,business_id,branch_id,employee_id,holder_employee_id,step,reason,installation_hash,attempted_at)
      VALUES(${f.companyId},${f.ids.newId()},${f.businessId},${f.branchId},${f.employeeId},${holder},'CLOCK',${reason},${hash},clock_timestamp())`),
      ),
    ).rejects.toThrow();
});
