import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import {
  addEmployee,
  grant,
  readState,
  cancelPending,
  cancelPendingAt,
  nextPhone,
  systemRoleId,
  staffAccessFixture,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';
import { createGrantEmployeeAccessSteps } from '../persistence/staff-access.adapter.ts';
import { createStaffAccessUserSteps } from '../persistence/staff-access-auth.adapter.ts';
import { GrantEmployeeAccessUseCase } from '../use-cases/grant-employee-access/grant-employee-access.ts';
import {
  EMPLOYEE_ACCESS_STATE_READS,
  type EmployeeAccessStateReads,
} from '../queries/employee-staff-access.query.ts';
import type { StaffAccessGrantCache } from '../ports/staff-access-user-steps.port.ts';
import { StaffAuthBusyError } from '@pospay/db';
const ids = systemUuidV7();
let f: Fixture;
beforeAll(async () => {
  f = await staffAccessFixture({ staffAccessRoutes: true });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it.each(['before-user', 'after-user', 'tenant-write'])(
  'P1-11 injected crash at %s resumes the real HTTP grant exactly once',
  async (stage) => {
    const employeeId = await addEmployee(
      f,
      'Crash ' + stage,
      f.salmiya,
      ['before-user', 'after-user', 'tenant-write'].indexOf(stage) + 101,
    );
    const phone = nextPhone(f);
    const real = f.h.auth.staffUsers.provision;
    if (stage !== 'tenant-write') {
      vi.spyOn(f.h.auth.staffUsers, 'provision').mockImplementationOnce(async (input) => {
        if (stage === 'after-user') await real(input);
        throw new Error('INJECTED_STAFF_CRASH');
      });
    } else {
      await f.h.owner
        .unsafe(`CREATE FUNCTION fail_staff_membership() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'INJECTED_STAFF_COMMIT_FAILURE'; END $$`);
      await f.h.owner.unsafe(`CREATE TRIGGER fail_staff_membership BEFORE INSERT ON memberships
      FOR EACH ROW EXECUTE FUNCTION fail_staff_membership()`);
    }
    try {
      expect((await grant(f, employeeId, phone)).status).toBe(500);
    } finally {
      vi.restoreAllMocks();
      if (stage === 'tenant-write')
        await f.h.owner.unsafe(
          'DROP TRIGGER fail_staff_membership ON memberships; DROP FUNCTION fail_staff_membership()',
        );
    }
    const [pending] = await f.h
      .owner`SELECT state,operation_id FROM employee_staff_access WHERE employee_id=${employeeId}`;
    expect(pending?.state).toBe('PENDING');
    expect(await f.h.owner`SELECT user_id FROM employees WHERE id=${employeeId}`).toMatchObject([
      { user_id: null },
    ]);
    expect((await grant(f, employeeId, phone)).status).toBe(200);
    const users = await f.h
      .owner`SELECT id FROM "user" WHERE staff_access_operation_id=${pending?.operation_id}`;
    expect(users).toHaveLength(1);
    expect(
      await f.h
        .owner`SELECT id FROM memberships WHERE user_id=${users[0]?.id} AND company_id=${f.company}`,
    ).toHaveLength(1);
    expect(
      await f.h
        .owner`SELECT id FROM outbox WHERE aggregate_id=${employeeId} AND event_type='StaffAccessGranted'`,
    ).toHaveLength(1);
  },
);

it('P1-1 state and ACTIVE conflict do not disclose another branch; GET takes no write lock', async () => {
  const employeeId = await addEmployee(f, 'Private branch', f.hawalli, 110);
  const phone = nextPhone(f);
  expect((await grant(f, employeeId, phone)).status).toBe(200);
  const hidden = await readState(f, employeeId, f.managerCookie);
  expect(hidden).toMatchObject({ status: 404, body: { code: 'EMPLOYEE_NOT_FOUND' } });
  expect(await grant(f, employeeId, phone, f.managerCookie)).toMatchObject({
    status: 403,
    body: { code: 'STAFF_ACCESS_NOT_ALLOWED' },
  });
  f.h.calls.statements.length = 0;
  expect((await readState(f, employeeId)).status).toBe(200);
  expect(f.h.calls.statements.map((s) => s.sql).join(' ')).not.toMatch(
    /FOR (UPDATE|NO KEY UPDATE|SHARE)/i,
  );
});

it('P1-2 cancel marks intent, survives auth failure and refuses resume during CANCELLING', async () => {
  const employeeId = await addEmployee(f, 'Cancel recovery', f.salmiya, 111);
  const phone = nextPhone(f);
  const real = f.h.auth.staffUsers.provision;
  vi.spyOn(f.h.auth.staffUsers, 'provision').mockImplementationOnce(async (input) => {
    await real(input);
    throw new Error('INJECTED_CRASH');
  });
  expect((await grant(f, employeeId, phone, f.managerCookie)).status).toBe(500);
  vi.restoreAllMocks();
  await f.h
    .owner`UPDATE employee_staff_access SET attempt_started_at=now()-interval '25 hours' WHERE employee_id=${employeeId}`;
  vi.spyOn(f.h.auth.staffUsers, 'cancel').mockRejectedValueOnce(
    new Error('INJECTED_CANCEL_FAILURE'),
  );
  expect((await cancelPending(f, employeeId)).status).toBe(500);
  vi.restoreAllMocks();
  expect(
    await f.h.owner`SELECT state FROM employee_staff_access WHERE employee_id=${employeeId}`,
  ).toMatchObject([{ state: 'CANCELLING' }]);
  expect(await grant(f, employeeId, phone)).toMatchObject({
    status: 403,
    body: { code: 'STAFF_ACCESS_NOT_ALLOWED' },
  });
  const [operation] = await f.h
    .owner`SELECT operation_id FROM employee_staff_access WHERE employee_id=${employeeId}`;
  expect((await cancelPending(f, employeeId)).status).toBe(200);
  expect(
    await f.h
      .owner`SELECT id FROM "user" WHERE staff_access_operation_id=${operation?.operation_id}`,
  ).toHaveLength(0);
  expect(
    await f.h.owner`SELECT id FROM employee_staff_access WHERE employee_id=${employeeId}`,
  ).toHaveLength(0);
});

it('P1-4 pending resume refuses a changed phone or role and STOPPED regrant binds the requested phone', async () => {
  const employeeId = await addEmployee(f, 'Bound resume', f.salmiya, 112);
  const phone = nextPhone(f);
  vi.spyOn(f.h.auth.staffUsers, 'provision').mockRejectedValueOnce(new Error('INJECTED_CRASH'));
  expect((await grant(f, employeeId, phone)).status).toBe(500);
  vi.restoreAllMocks();
  expect(await grant(f, employeeId, nextPhone(f))).toMatchObject({
    status: 403,
    body: { code: 'STAFF_ACCESS_NOT_ALLOWED' },
  });
  expect(await grant(f, employeeId, phone, f.ownerCookie, { role: 'reception' })).toMatchObject({
    status: 403,
  });
  expect((await grant(f, employeeId, phone)).status).toBe(200);
  const [record] = await f.h
    .owner`SELECT user_id,membership_id FROM employee_staff_access WHERE employee_id=${employeeId}`;
  await f.h.owner`UPDATE memberships SET ends_at=now() WHERE id=${record?.membership_id}`;
  await f.h.owner`UPDATE employee_staff_access SET state='STOPPED' WHERE employee_id=${employeeId}`;
  const replacement = nextPhone(f);
  expect(
    (await grant(f, employeeId, replacement, f.ownerCookie, { role: 'reception' })).status,
  ).toBe(200);
  expect(
    await f.h
      .owner`SELECT phone_number,phone_binding_approved_at FROM "user" WHERE id=${record?.user_id}`,
  ).toMatchObject([{ phone_number: replacement, phone_binding_approved_at: expect.any(Date) }]);
});

it('P1-2 an equally authorized branch manager cannot cancel another granter pending operation', async () => {
  const employee = await addEmployee(f, 'Original granter only', f.salmiya, 113);
  const phone = nextPhone(f);
  vi.spyOn(f.h.auth.staffUsers, 'provision').mockRejectedValueOnce(new Error('INJECTED_CRASH'));
  expect((await grant(f, employee, phone, f.managerCookie)).status).toBe(500);
  vi.restoreAllMocks();
  await f.h.owner`UPDATE employee_staff_access SET attempt_started_at=now()-interval '25 hours' WHERE employee_id=${employee}`;
  const cookie = await f.h.signedInOperator('other-granter@example.test');
  const actor = await f.h.auth.getSession(new Headers({ cookie }));
  if (actor === null) throw new Error('ACTOR_MISSING');
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${employee},${actor.userId},${systemRoleId('branch_manager')},'global','BRANCH',${f.salmiya})`;
  expect(await cancelPending(f, employee, cookie)).toMatchObject({ status: 403, body: { code: 'STAFF_ACCESS_NOT_ALLOWED' } });
  expect(await f.h.owner`SELECT state FROM employee_staff_access WHERE employee_id=${employee}`).toMatchObject([{ state: 'PENDING' }]);
  expect((await cancelPending(f, employee, f.managerCookie)).status).toBe(200);
});

it.each(['before_auth', 'after_auth'] as const)(
  'P1-2/3/4 cancel after STOPPED regrant crash %s counts from the new attempt, restores STOPPED and allows a corrected grant',
  async (phase) => {
    const employee = await addEmployee(f, 'Committed recovery ' + phase, f.salmiya, phase === 'before_auth' ? 114 : 115);
    const oldPhone = nextPhone(f);
    expect((await grant(f, employee, oldPhone)).status).toBe(200);
    const [before] = await f.h.owner`SELECT id,user_id,membership_id FROM employee_staff_access WHERE employee_id=${employee}`;
    await f.h.owner`UPDATE memberships SET ends_at=now() WHERE id=${before?.membership_id}`;
    await f.h.owner`DELETE FROM cashier_pins WHERE user_id=${before?.user_id}`;
    // السجل عمره أسبوع: عمر السجل الأصلي لا يجوز أن يُحتسب على محاولة إعادة المنح الحالية (P1-3).
    // ولحظة المحاولة كمان بترجع أسبوع: من غير رجوعها الاختبار ما بيعرفش إن إعادة المنح كتبت لحظة محاولة جديدة.
    await f.h.owner`UPDATE employee_staff_access SET state='STOPPED',created_at=now()-interval '7 days',attempt_started_at=now()-interval '7 days' WHERE employee_id=${employee}`;
    const phone = nextPhone(f);
    const real = f.h.auth.staffUsers.provision;
    vi.spyOn(f.h.auth.staffUsers, 'provision').mockImplementationOnce(async (input) => {
      if (phase === 'after_auth') await real(input);
      throw new Error('INJECTED_REGRANT_CRASH');
    });
    try {
      expect((await grant(f, employee, phone)).status).toBe(500);
    } finally {
      vi.restoreAllMocks();
    }
    const hour = 60 * 60 * 1000;
    await expect(cancelPendingAt(f, employee, new Date(Date.now() + hour))).rejects.toMatchObject({
      code: 'STAFF_ACCESS_NOT_ALLOWED',
    });
    expect(await f.h.owner`SELECT state FROM employee_staff_access WHERE employee_id=${employee}`)
      .toMatchObject([{ state: 'PENDING' }]);
    const cancel = vi.spyOn(f.h.auth.staffUsers, 'cancel');
    try {
      await cancelPendingAt(f, employee, new Date(Date.now() + 25 * hour));
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
    expect(await readState(f, employee)).toMatchObject({ status: 200, body: { state: 'STOPPED' } });
    expect(await f.h.owner`SELECT state,user_id,membership_id FROM employee_staff_access WHERE employee_id=${employee}`)
      .toMatchObject([{ state: 'STOPPED', user_id: before?.user_id, membership_id: before?.membership_id }]);
    const [bound] = await f.h.owner`SELECT phone_number FROM "user" WHERE id=${before?.user_id}`;
    expect(bound?.phone_number === (phase === 'after_auth' ? phone : oldPhone)).toBe(true);
    expect(await f.h.owner`SELECT id FROM memberships WHERE id=${before?.membership_id} AND ends_at IS NOT NULL`).toHaveLength(1);
    expect(await f.h.owner`SELECT id FROM cashier_pins WHERE user_id=${before?.user_id}`).toHaveLength(0);
    expect(await f.h.owner`SELECT id FROM session WHERE user_id=${before?.user_id}`).toHaveLength(0);
    expect(await f.h.owner`SELECT action FROM audit_log WHERE entity_id=${before?.id} AND action='regrant_cancelled'`).toHaveLength(1);
    expect((await grant(f, employee, nextPhone(f))).status).toBe(200);
    expect(await f.h.owner`SELECT state,user_id FROM employee_staff_access WHERE employee_id=${employee}`)
      .toMatchObject([{ state: 'ACTIVE', user_id: before?.user_id }]);
  },
);

it('AC-ACT-4 a re-grant of a stopped record starts a new attempt whose time is the injected clock', async () => {
  const employee = await addEmployee(f, 'Attempt time pinned', f.salmiya, 118);
  const oldPhone = nextPhone(f);
  expect((await grant(f, employee, oldPhone)).status).toBe(200);
  const [before] = await f.h
    .owner`SELECT id,user_id,membership_id FROM employee_staff_access WHERE employee_id=${employee}`;
  await f.h.owner`UPDATE memberships SET ends_at=now() WHERE id=${before?.membership_id}`;
  await f.h.owner`DELETE FROM cashier_pins WHERE user_id=${before?.user_id}`;
  // السجل متوقف وعمره أسبوع: المحاولة الجديدة تبدأ بلحظة المنح الجديدة مش بلحظة السجل.
  await f.h
    .owner`UPDATE employee_staff_access SET state='STOPPED',created_at=now()-interval '7 days',attempt_started_at=now()-interval '7 days' WHERE employee_id=${employee}`;
  const phone = nextPhone(f);
  const actor = await f.h.auth.getSession(new Headers({ cookie: f.ownerCookie }));
  if (actor === null) throw new Error('ACTOR_MISSING');
  // ساعة محقونة بلحظة ثابتة: أي كتابة لوقت المحاولة لازم تساويها بالظبط من غير تسامح.
  const regrantAt = new Date('2026-11-25T09:15:30.250Z');
  const useCase = new GrantEmployeeAccessUseCase(
    createGrantEmployeeAccessSteps(f.db, f.h.auth.staffUsers, f.cardKey),
    createStaffAccessUserSteps(f.h.auth.staffUsers),
    { invalidate: async () => undefined },
    { now: () => regrantAt },
    ids,
  );
  const outcome = await useCase.execute({
    companyId: f.company,
    userId: actor.userId,
    businessId: f.business,
    employeeId: employee,
    phone,
    role: 'staff',
    pin: '1234',
  });
  expect(outcome.kind).toBe('granted');
  const [record] = await f.h
    .owner`SELECT attempt_started_at FROM employee_staff_access WHERE employee_id=${employee}`;
  expect(new Date(record?.['attempt_started_at'] as Date).getTime()).toBe(regrantAt.getTime());
});

it('a transient auth failure answers TRANSACTION_RETRY_REQUIRED and the same request then completes', async () => {
  const employeeId = await addEmployee(f, 'Busy auth', f.salmiya, 116);
  const phone = nextPhone(f);
  vi.spyOn(f.h.auth.staffUsers, 'provision').mockRejectedValueOnce(new StaffAuthBusyError());
  try {
    expect(await grant(f, employeeId, phone)).toMatchObject({
      status: 409,
      body: { code: 'TRANSACTION_RETRY_REQUIRED' },
    });
  } finally {
    vi.restoreAllMocks();
  }
  expect((await grant(f, employeeId, phone)).status).toBe(200);
});

it('AC-ACT-2 a repeated re-grant of the same attempt approves the phone binding once', async () => {
  const employeeId = await addEmployee(f, 'Idempotent regrant', f.salmiya, 117);
  const phone = nextPhone(f);
  expect((await grant(f, employeeId, phone)).status).toBe(200);
  const [record] = await f.h
    .owner`SELECT id,user_id,membership_id FROM employee_staff_access WHERE employee_id=${employeeId}`;
  await f.h.owner`UPDATE memberships SET ends_at=now() WHERE id=${record?.membership_id}`;
  await f.h.owner`UPDATE employee_staff_access SET state='STOPPED' WHERE employee_id=${employeeId}`;
  const replacement = nextPhone(f);
  // انهيار بعد خطوة auth: الربط اتأكد وصف التدقيق اتكتب، والتسجيل فضل PENDING بنفس المحاولة.
  const real = f.h.auth.staffUsers.provision;
  vi.spyOn(f.h.auth.staffUsers, 'provision').mockImplementationOnce(async (input) => {
    await real(input);
    throw new Error('INJECTED_REGRANT_CRASH');
  });
  try {
    expect((await grant(f, employeeId, replacement)).status).toBe(500);
  } finally {
    vi.restoreAllMocks();
  }
  const [attempt] = await f.h
    .owner`SELECT attempt_id FROM employee_staff_access WHERE employee_id=${employeeId}`;
  const bindingRows = () =>
    f.h.owner`SELECT details FROM platform_audit_log
      WHERE action='phone.binding_approved' AND details->>'user_id'=${record?.user_id}`;
  const attemptRows = () =>
    f.h.owner`SELECT details FROM platform_audit_log
      WHERE action='phone.binding_approved' AND details->>'user_id'=${record?.user_id}
        AND details->>'attempt_id'=${attempt?.attempt_id}`;
  // صف واحد لإنشاء الحساب وصف واحد لاعتماد الهاتف الجديد — كل واحد في محاولته.
  expect(await bindingRows()).toHaveLength(2);
  expect(await attemptRows()).toHaveLength(1);
  // تكرار نفس الطلب بنفس المحاولة: مفيش اعتماد تاني ولا صف تاني.
  expect((await grant(f, employeeId, replacement)).status).toBe(200);
  expect(await bindingRows()).toHaveLength(2);
  expect(await attemptRows()).toHaveLength(1);
  expect(
    await f.h.owner`SELECT phone_number, phone_binding_approved_at FROM "user" WHERE id=${record?.user_id}`,
  ).toMatchObject([{ phone_number: replacement, phone_binding_approved_at: expect.any(Date) }]);
});

it('AC-ACT-11 a state read that fails after a committed cancel still answers 200 with the committed state', async () => {
  const employee = await addEmployee(f, 'Unreadable cancel', f.salmiya, 119);
  const [owner] = await f.h
    .owner`SELECT id FROM "user" WHERE email='staff-access-owner@example.test'`;
  await f.h.owner`INSERT INTO employee_staff_access
    (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by,attempt_id,attempt_started_at,phone_hash)
    VALUES (${f.company},${ids.newId()},${f.business},${employee},${ids.newId()},'staff',${f.salmiya},'PENDING',
      ${owner?.id},${ids.newId()}, now() - interval '25 hours',${'a'.repeat(64)})`;
  // قراءة الحالة هي اللي بتجيب رد المسار: فشلها بعد الإلغاء ما بيرجعش النتيجة الملتزمة لخطأ.
  const reads = f.h.app.get<EmployeeAccessStateReads | null>(EMPLOYEE_ACCESS_STATE_READS);
  if (reads === null) throw new Error('STATE_READS_MISSING');
  vi.spyOn(reads, 'state').mockRejectedValueOnce(new Error('INJECTED_STATE_READ_FAILURE'));
  try {
    expect(await cancelPending(f, employee)).toMatchObject({
      status: 200,
      body: { state: 'NONE' },
    });
  } finally {
    vi.restoreAllMocks();
  }
  // الإلغاء تزم فعلاً: الرد مبني على النتيجة الملتزمة لا على قراءة نجحت بالصدفة.
  expect(
    await f.h.owner`SELECT id FROM employee_staff_access WHERE employee_id = ${employee}`,
  ).toHaveLength(0);
});

it('AC-ACT-11 a cache invalidation that fails after a committed grant still answers 200 with the committed state', async () => {
  const employee = await addEmployee(f, 'Stale cache grant', f.salmiya, 120);
  const phone = nextPhone(f);
  // منفذ إبطال الكاش هو منفذ Redis: فشله بعد الالتزام ما بيرجعش المنحة الملتومة لخطأ.
  const cache = (
    f.h.app.get(GrantEmployeeAccessUseCase) as unknown as { cache: StaffAccessGrantCache }
  ).cache;
  vi.spyOn(cache, 'invalidate').mockRejectedValueOnce(new Error('INJECTED_CACHE_FAILURE'));
  try {
    expect(await grant(f, employee, phone)).toMatchObject({
      status: 200,
      body: { state: 'ACTIVE' },
    });
  } finally {
    vi.restoreAllMocks();
  }
  expect(
    await f.h.owner`SELECT state FROM employee_staff_access WHERE employee_id = ${employee}`,
  ).toMatchObject([{ state: 'ACTIVE' }]);
});
