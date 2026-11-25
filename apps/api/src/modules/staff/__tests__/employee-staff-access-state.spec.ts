import { systemUuidV7 } from '@pospay/ids';
import { StaffAuthBusyError } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
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
      (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by,phone_hash,attempt_id)
      VALUES (${f.company},${ids.newId()},${f.business},${foreignEmployee},${ids.newId()},'staff',${f.salmiya},'PENDING',
        ${ownerUser?.id},${'a'.repeat(64)},${ids.newId()})`),
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
    (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by,attempt_id,attempt_started_at,phone_hash)
    VALUES (${f.company},${ids.newId()},${f.business},${fresh},${ids.newId()},'reception',${f.salmiya},'PENDING',
      ${ownerUser?.id},${ids.newId()}, now() - interval '25 hours',${'a'.repeat(64)})`;
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

it('AC-ACT-3 a transient auth failure on the read route answers TRANSACTION_RETRY_REQUIRED', async () => {
  const linked = await addEmployee(f, 'Busy read', f.salmiya, 21);
  const phone = nextPhone(f);
  expect((await grant(f, linked, phone)).status).toBe(200);
  vi.spyOn(f.h.auth.staffUsers, 'read').mockRejectedValueOnce(new StaffAuthBusyError());
  try {
    expect(await readState(f, linked)).toMatchObject({
      status: 409,
      body: { code: 'TRANSACTION_RETRY_REQUIRED' },
    });
  } finally {
    vi.restoreAllMocks();
  }
  expect((await readState(f, linked)).status).toBe(200);
});

/** سجل انتظار للمانح المعطى وعمر المحاولة المعطى — السجل بيتقري من ساعة القاعدة. */
async function pendingRecord(
  employeeId: string,
  grantedBy: string,
  attemptAge: string,
): Promise<void> {
  await f.h.owner`INSERT INTO employee_staff_access
    (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by,attempt_id,attempt_started_at,phone_hash)
    VALUES (${f.company},${ids.newId()},${f.business},${employeeId},${ids.newId()},'staff',${f.salmiya},'PENDING',
      ${grantedBy},${ids.newId()}, now() - ${attemptAge}::interval,${'a'.repeat(64)})`;
}

/** مدير آخر للشركة: دور مخصص يقرأ الموظفة ويدير دخول فرع السالمية — مش هو المانح ولا المالك. */
async function otherManager(): Promise<{ cookie: string; userId: string }> {
  const cookie = await f.h.signedInOperator('staff-access-other-manager@example.test');
  const [user] = await f.h
    .owner`SELECT id FROM "user" WHERE email='staff-access-other-manager@example.test'`;
  const role = ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${f.company},'synthetic_staff_manager','Synthetic staff manager')`;
  for (const permission of ['manage:employees:business', 'manage:staff-access:branch']) {
    await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
      VALUES (${role},${f.company},${f.company},${permission})`;
  }
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${ids.newId()},${user?.['id']},${role},${f.company},'BUSINESS',${f.business})`;
  return { cookie, userId: user?.['id'] as string };
}

it('AC-ACT-10 the cancel permission belongs to the granter or the owner and only after 24 hours', async () => {
  const [owner] = await f.h
    .owner`SELECT id FROM "user" WHERE email='staff-access-owner@example.test'`;
  const ownerId = owner?.['id'] as string;
  const manager = await otherManager();
  const young = await addEmployee(f, 'Young attempt', f.salmiya, 22);
  const byOwner = await addEmployee(f, 'Granted by the owner', f.salmiya, 23);
  const byManager = await addEmployee(f, 'Granted by the other manager', f.salmiya, 24);
  await pendingRecord(young, ownerId, '1 hour');
  await pendingRecord(byOwner, ownerId, '25 hours');
  await pendingRecord(byManager, manager.userId, '25 hours');
  // المحاولة الشابة: الإلغاء مقفول حتى على المانح نفسه.
  expect((await readState(f, young)).body).toMatchObject({
    state: 'PENDING',
    can_manage: true,
    can_cancel: false,
  });
  // السجل القديم: المانح الأصلي يلغيه.
  expect((await readState(f, byOwner)).body).toMatchObject({
    state: 'PENDING',
    can_cancel: true,
  });
  // مدير تاني مش المانح ومش مالك الشركة: الإلغاء مقفول مع إن صلاحية الفرع موجودة.
  expect((await readState(f, byOwner, manager.cookie)).body).toMatchObject({
    state: 'PENDING',
    can_manage: true,
    can_cancel: false,
  });
  // المدير التاني هو المانح الأصلي: الإلغاء مفتوح.
  expect((await readState(f, byManager, manager.cookie)).body).toMatchObject({
    state: 'PENDING',
    can_cancel: true,
  });
  // مالك الشركة يلغي سجل مانحه غيره.
  expect((await readState(f, byManager)).body).toMatchObject({
    state: 'PENDING',
    can_cancel: true,
  });
});
