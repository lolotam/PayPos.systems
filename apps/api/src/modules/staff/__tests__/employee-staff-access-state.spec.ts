import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  addEmployee,
  cancelPending,
  grant,
  nextPhone,
  readState,
  staffAccessFixture,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';

const ids = systemUuidV7();
let f: Fixture;
beforeAll(async () => {
  f = await staffAccessFixture({ staffAccessRoutes: true });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('AC-F1-8 RLS: another tenant reads zero rows and cannot write ours', async () => {
  const seeded = await addEmployee(f, 'RLS own seed', f.salmiya, 90);
  expect((await grant(f, seeded, nextPhone(f))).status).toBe(200);
  const rows = await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`SELECT id FROM employee_staff_access`),
  );
  expect(rows.length).toBeGreaterThan(0);
  const otherCookie = await f.h.signedInOperator('staff-access-foreign@example.test');
  const otherCompany = await f.h.onboard(otherCookie, 'Foreign employer');
  const foreign = await f.db.withTenant(otherCompany, (tx) =>
    tx.execute(sql`SELECT id FROM employee_staff_access`),
  );
  expect(foreign).toHaveLength(0);
  const [ownerUser] = await f.h
    .owner`SELECT id FROM "user" WHERE email='staff-access-owner@example.test'`;
  const foreignEmployee = await addEmployee(f, 'Foreign target', f.salmiya, 14);
  const write = f.db.withTenant(otherCompany, (tx) =>
    tx.execute(sql`INSERT INTO employee_staff_access
      (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by,phone_hash)
      VALUES (${f.company},${ids.newId()},${f.business},${foreignEmployee},${ids.newId()},'staff',${f.salmiya},'PENDING',
        ${ownerUser?.id},${'a'.repeat(64)})`),
  );
  await expect(write).rejects.toMatchObject({ cause: { code: '42501' } });
});

it('AC-F1-9 the audit holds the four rows with the granter as actor and no PIN or phone', async () => {
  const [ownerUser] = await f.h
    .owner`SELECT id FROM "user" WHERE email='staff-access-owner@example.test'`;
  const hoda = await addEmployee(f, 'Hoda', f.salmiya, 15);
  const phone = nextPhone(f);
  expect((await grant(f, hoda, phone)).status).toBe(200);
  const [record] = await f.h
    .owner`SELECT id, user_id, membership_id FROM employee_staff_access WHERE employee_id = ${hoda}`;
  const rows = await f.h.owner`SELECT entity, action, actor_user_id, before, after FROM audit_log
    WHERE company_id = ${f.company}
      AND (entity_id = ${hoda}
        OR entity_id = ${record?.id}
        OR entity_id = ${record?.membership_id}
        OR (entity = 'cashier_pin' AND entity_id = ${record?.user_id}))
    ORDER BY at`;
  const actions = rows.map((row) => `${row.entity}.${row.action}`);
  expect(actions).toContain('employee_staff_access.created');
  expect(actions).toContain('membership.created');
  expect(actions).toContain('employee.updated');
  expect(actions).toContain('cashier_pin.staff.pin_set_temporary');
  expect(rows.every((row) => row.actor_user_id === ownerUser?.id)).toBe(true);
  const [platform] = await f.h.owner`SELECT action, actor FROM platform_audit_log
    WHERE details->>'user_id' = ${record?.user_id} AND action = 'phone.binding_approved'`;
  expect(platform?.actor).toBe(ownerUser?.id);
  for (const row of [...rows, platform]) {
    expect(JSON.stringify(row)).not.toContain('1234');
    expect(JSON.stringify(row)).not.toContain(phone);
  }
});

it('FR-F1-1 the GET state covers NONE, PENDING and a foreign employee 404', async () => {
  const fresh = await addEmployee(f, 'Unlinked', f.salmiya, 20);
  const none = await readState(f, fresh);
  expect(none.body).toMatchObject({
    state: 'NONE',
    can_manage: true,
    role: null,
    phone_last3: null,
  });
  const foreign = await readState(f, ids.newId());
  expect(foreign.status).toBe(404);
  expect(foreign.body).toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
  const [ownerUser] = await f.h
    .owner`SELECT id FROM "user" WHERE email='staff-access-owner@example.test'`;
  await f.h.owner`INSERT INTO employee_staff_access
    (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by,created_at,phone_hash)
    VALUES (${f.company},${ids.newId()},${f.business},${fresh},${ids.newId()},'reception',${f.salmiya},'PENDING',
      ${ownerUser?.id}, now() - interval '25 hours',${'a'.repeat(64)})`;
  const pendingState = await readState(f, fresh);
  expect(pendingState.body).toMatchObject({
    state: 'PENDING',
    role: 'reception',
    can_manage: true,
  });
  const cancelled = await cancelPending(f, fresh);
  expect(cancelled).toMatchObject({ status: 200, body: { state: 'NONE' } });
  expect(
    await f.h.owner`SELECT id FROM employee_staff_access WHERE employee_id = ${fresh}`,
  ).toHaveLength(0);
});
