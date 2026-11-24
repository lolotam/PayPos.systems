import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  addEmployee,
  grant,
  cancelPending,
  cancelPendingAt,
  nextPhone,
  systemRoleId,
  staffAccessFixture,
  verifyStaffPin,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';
import { createGrantEmployeeAccessSteps } from '../persistence/staff-access.adapter.ts';
import { createStaffAccessUserSteps } from '../persistence/staff-access-auth.adapter.ts';
import { GrantEmployeeAccessUseCase } from '../use-cases/grant-employee-access/grant-employee-access.ts';
const ids = systemUuidV7();
let f: Fixture;
beforeAll(async () => {
  f = await staffAccessFixture({ staffAccessRoutes: true });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
function barrier(count = 1) {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let calls = 0;
  return {
    entered,
    release,
    arrive: async () => {
      if (++calls === count) reached();
      await wait;
    },
  };
}
async function command(
  employeeId: string,
  phone: string,
  who: { cookie?: string; role?: 'staff' | 'reception'; pin?: string } = {},
) {
  const actor = await f.h.auth.getSession(new Headers({ cookie: who.cookie ?? f.ownerCookie }));
  if (actor === null) throw new Error('ACTOR_MISSING');
  return {
    companyId: f.company,
    userId: actor.userId,
    businessId: f.business,
    employeeId,
    phone,
    role: who.role ?? ('staff' as const),
    pin: who.pin ?? '1234',
  };
}
const lockTraces: string[][] = [];
const dialect = new PgDialect();
function observedDatabase() {
  return { ...f.db, withTenant: ((companyId, work, options) => f.db.withTenant(companyId, (tx) => {
    const locks: string[] = [];
    lockTraces.push(locks);
    return work(new Proxy(tx, { get(target, property, receiver) {
      if (property !== 'execute') return Reflect.get(target, property, receiver);
      return (query: SQL) => {
        const text = dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ');
        if (/FOR (UPDATE|NO KEY UPDATE)/i.test(text)) locks.push(text);
        return target.execute(query);
      };
    } }));
  }, options)) as typeof f.db.withTenant };
}
function grantCase(
  hashBarrier?: ReturnType<typeof barrier>,
  provisionBarrier?: ReturnType<typeof barrier>,
  steps = createGrantEmployeeAccessSteps(observedDatabase(), f.h.auth.staffUsers),
) {
  const users = createStaffAccessUserSteps(f.h.auth.staffUsers);
  const hash = users.hash;
  const provision = users.provision;
  users.hash = async (pin) => {
    await hashBarrier?.arrive();
    return hash(pin);
  };
  users.provision = async (input) => {
    await provisionBarrier?.arrive();
    return provision(input);
  };
  return new GrantEmployeeAccessUseCase(
    steps,
    users,
    { invalidate: async () => undefined },
    { now: () => new Date() },
    ids,
  );
}
/** يوقف دخول موظفة منحت سابقاً كما يفعل F3: عضوية منتهية وبلا رقم سري وسجل STOPPED. */
async function stopAccess(employeeId: string) {
  const [before] = await f.h
    .owner`SELECT user_id,membership_id FROM employee_staff_access WHERE employee_id=${employeeId}`;
  await f.h.owner`UPDATE memberships SET ends_at=now() WHERE id=${before?.membership_id}`;
  await f.h.owner`DELETE FROM cashier_pins WHERE user_id=${before?.user_id}`;
  await f.h.owner`UPDATE employee_staff_access SET state='STOPPED' WHERE employee_id=${employeeId}`;
  return before;
}
it('P1-3/4 same-operation requests overlap at a barrier and produce one membership without PHONE_TAKEN', async () => {
  const employeeId = await addEmployee(f, 'Concurrent grants', f.salmiya, 301);
  const input = await command(employeeId, nextPhone(f));
  const gate = barrier(2);
  const useCase = grantCase(gate);
  const first = useCase.execute(input);
  const second = useCase.execute(input);
  await gate.entered;
  gate.release();
  const outcomes = await Promise.all([first, second]);
  expect(outcomes.map((r) => r.kind).sort()).toEqual(['already', 'granted']);
  for (const locks of lockTraces) {
    expect(locks[0]).toMatch(/FROM companies/);
    expect(locks[1]).toMatch(/FROM employees/);
    expect(locks[2]).toMatch(/FROM employee_staff_access/);
  }
  const [record] = await f.h
    .owner`SELECT user_id FROM employee_staff_access WHERE employee_id=${employeeId}`;
  expect(
    await f.h
      .owner`SELECT id FROM memberships WHERE company_id=${f.company} AND user_id=${record?.user_id}`,
  ).toHaveLength(1);
  expect(
    await f.h
      .owner`SELECT id FROM outbox WHERE aggregate_id=${employeeId} AND event_type='StaffAccessGranted'`,
  ).toHaveLength(1);
});
it('P1-2 cancel waits for in-flight auth provisioning, then deletes the account; stale commit cannot activate it', async () => {
  const employeeId = await addEmployee(f, 'Concurrent cancel', f.salmiya, 302);
  const input = await command(employeeId, nextPhone(f));
  vi.spyOn(f.h.auth.staffUsers, 'provision').mockRejectedValueOnce(
    new Error('INJECTED_BEFORE_AUTH'),
  );
  expect((await grant(f, employeeId, input.phone)).status).toBe(500);
  vi.restoreAllMocks();
  await f.h
    .owner`UPDATE employee_staff_access SET attempt_started_at=now()-interval '25 hours' WHERE employee_id=${employeeId}`;
  const authGate = barrier();
  const hashGate = barrier();
  const pending = grantCase(hashGate, authGate).execute(input);
  await authGate.entered;
  // authGate is entered with company/employee/record held: cancellation cannot overtake provisioning.
  const cancel = cancelPending(f, employeeId);
  authGate.release();
  await hashGate.entered;
  expect((await cancel).status).toBe(200);
  hashGate.release();
  await expect(pending).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
  expect(await f.h.owner`SELECT id FROM "user" WHERE phone_number=${input.phone}`).toHaveLength(0);
  expect(
    await f.h.owner`SELECT id FROM employee_staff_access WHERE employee_id=${employeeId}`,
  ).toHaveLength(0);
});
it('P1-3 real employee edit overlaps grant at a barrier without lock inversion', async () => {
  const employeeId = await addEmployee(f, 'Concurrent edit', f.salmiya, 303);
  const gate = barrier();
  const pending = grantCase(gate).execute(await command(employeeId, nextPhone(f)));
  await gate.entered;
  const [employee] = await f.h.owner`SELECT revision FROM employees WHERE id=${employeeId}`;
  const edit = await f.h.send('PATCH', `/v1/businesses/${f.business}/employees/${employeeId}`, {
    cookie: f.ownerCookie,
    company: f.company,
    body: {
      name_en: 'Edited while granting',
      role_code: 'staff',
      hire_date: '2026-01-01',
      user_id: null,
      branch_ids: [f.salmiya],
      primary_branch_id: f.salmiya,
      expected_revision: employee?.revision,
      branch_effective_date: '2026-11-24',
    },
  });
  gate.release();
  expect(edit.status).toBe(200);
  expect(await pending).toMatchObject({ kind: 'granted' });
});

it('P1-2 a request resumed after another grant commits never provisions an ACTIVE operation', async () => {
  const employeeId = await addEmployee(f, 'Committed overlap', f.salmiya, 304);
  const input = await command(employeeId, nextPhone(f));
  const gate = barrier();
  const steps = createGrantEmployeeAccessSteps(f.db, f.h.auth.staffUsers);
  const begin = steps.begin;
  let calls = 0;
  steps.begin = async (...args) => {
    const result = await begin(...args);
    if (++calls === 1) await gate.arrive();
    return result;
  };
  const users = createStaffAccessUserSteps(f.h.auth.staffUsers);
  const provision = vi.spyOn(users, 'provision');
  const useCase = new GrantEmployeeAccessUseCase(
    steps, users, { invalidate: async () => undefined }, { now: () => new Date() }, ids,
  );
  const delayed = useCase.execute(input);
  await gate.entered;
  try {
    expect((await grant(f, employeeId, input.phone)).status).toBe(200);
  } finally {
    gate.release();
  }
  expect(await delayed).toMatchObject({ kind: 'already' });
  expect(provision).not.toHaveBeenCalled();
});

it('P1-1 a stale attempt cannot commit a newer re-grant of the same record', async () => {
  const employeeId = await addEmployee(f, 'Stale attempt', f.salmiya, 305);
  expect((await grant(f, employeeId, nextPhone(f))).status).toBe(200);
  const stopped = await stopAccess(employeeId);
  const phone = nextPhone(f);
  const first = await command(employeeId, phone);
  const second = await command(employeeId, phone, {
    cookie: f.managerCookie,
    role: 'reception',
    pin: '9876',
  });
  const firstGate = barrier();
  const secondGate = barrier();
  const stale = grantCase(firstGate).execute(first);
  await firstGate.entered;
  // الطلب الأول أنهى auth وينتظر قبل الالتزام؛ الإلغاء يعيد السجل إلى STOPPED ثم يبدأ الثاني محاولته.
  await cancelPendingAt(f, employeeId, new Date(Date.now() + 25 * 60 * 60 * 1000));
  expect(
    await f.h.owner`SELECT state FROM employee_staff_access WHERE employee_id=${employeeId}`,
  ).toMatchObject([{ state: 'STOPPED' }]);
  const fresh = grantCase(secondGate).execute(second);
  await secondGate.entered;
  firstGate.release();
  await expect(stale).rejects.toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  secondGate.release();
  expect(await fresh).toMatchObject({ kind: 'granted' });
  const [pin] = await f.h
    .owner`SELECT pin_hash,set_by FROM cashier_pins WHERE user_id=${stopped?.user_id}`;
  expect(pin?.set_by).toBe(second.userId);
  expect(await verifyStaffPin('9876', pin?.pin_hash as string)).toBe(true);
  expect(await verifyStaffPin('1234', pin?.pin_hash as string)).toBe(false);
  const [record] = await f.h
    .owner`SELECT role_code,granted_by FROM employee_staff_access WHERE employee_id=${employeeId}`;
  expect(record).toMatchObject({ role_code: 'reception', granted_by: second.userId });
  expect(
    await f.h.owner`SELECT id FROM memberships WHERE user_id=${stopped?.user_id} AND ends_at IS NULL
      AND role_id=${systemRoleId('cashier')}`,
  ).toHaveLength(1);
});

it('P1-2 authority removed between the first step and provisioning writes nothing to auth', async () => {
  const cookie = await f.h.signedInOperator('lost-authority@example.test');
  const actor = await f.h.auth.getSession(new Headers({ cookie }));
  if (actor === null) throw new Error('ACTOR_MISSING');
  const membership = ids.newId();
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${membership},${actor.userId},${systemRoleId('branch_manager')},'global','BRANCH',${f.salmiya})`;
  const employeeId = await addEmployee(f, 'Authority lost', f.salmiya, 306);
  const input = await command(employeeId, nextPhone(f), { cookie });
  const gate = barrier();
  const steps = createGrantEmployeeAccessSteps(f.db, f.h.auth.staffUsers);
  const begin = steps.begin;
  let calls = 0;
  steps.begin = async (...args) => {
    const result = await begin(...args);
    if (++calls === 1) await gate.arrive();
    return result;
  };
  const delayed = grantCase(undefined, undefined, steps).execute(input);
  await gate.entered;
  await f.h.owner`DELETE FROM memberships WHERE company_id=${f.company} AND id=${membership}`;
  gate.release();
  await expect(delayed).rejects.toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  expect(await f.h.owner`SELECT id FROM "user" WHERE phone_number=${input.phone}`).toHaveLength(0);
  expect(
    await f.h.owner`SELECT id FROM "user" WHERE staff_access_company_id=${f.company}
      AND staff_access_operation_id=(SELECT operation_id FROM employee_staff_access WHERE employee_id=${employeeId})`,
  ).toHaveLength(0);
});
