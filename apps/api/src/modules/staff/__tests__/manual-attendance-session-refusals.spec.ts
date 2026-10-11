import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  attendanceChangeFixture,
  changeActor,
  changeInput,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { seedSession } from './attendance-correction.fixture.ts';
import { leaveIds, leaveTerms, leaveActor } from './leave.fixture.ts';
import { AttendanceChangeKindRefusal } from '../ports/attendance-change-kinds.port.ts';
import { paired, origin } from '../../../../test/staff-otp-harness.ts';

let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture(true);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const terms = (day: string) => ({
  ...changeInput(f),
  clock_in: `${day}T07:00:00.000Z`,
  clock_out: `${day}T16:00:00.000Z`,
});
const approve = (id: string) =>
  f.decideChange.execute(changeActor(f, id, f.owner), { decision: 'APPROVED', revision: 0 });

it('AMS-04 refuses bad times and historical ineligibility without requests or idempotency rows', async () => {
  for (const [patch, code] of [
    [{ clock_out: changeInput(f).clock_in }, 'ATTENDANCE_MANUAL_INVALID_TIMES'],
    [{ clock_out: '2026-10-03T23:00:00.001Z' }, 'ATTENDANCE_MANUAL_INVALID_TIMES'],
    [
      { clock_in: '1990-01-01T07:00:00Z', clock_out: '1990-01-01T08:00:00Z' },
      'ATTENDANCE_MANUAL_NOT_ELIGIBLE',
    ],
  ] as const) {
    const key = leaveIds.newId();
    const before = await f.h.owner`SELECT id FROM attendance_change_requests`;
    const response = await f.h.app.inject({
      method: 'POST',
      url: `/v1/businesses/${f.business}/attendance-change-requests`,
      headers: { cookie: f.approverCookie, 'x-company-id': f.company, 'idempotency-key': key },
      payload: { ...changeInput(f), ...patch },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code,
      message_ar: expect.any(String),
      message_en: expect.any(String),
    });
    expect(await f.h.owner`SELECT id FROM attendance_change_requests`).toEqual(before);
    expect(await f.h.owner`SELECT key FROM idempotency_keys WHERE key=${key}`).toHaveLength(0);
  }
});

it('AMS-05 rechecks real-session overlap at approval and leaves the request PENDING', async () => {
  const row = await f.fileChange.execute(changeActor(f), terms('2026-09-20'));
  await seedSession(f, {
    employeeId: f.employee.id,
    workingDate: '2026-09-20',
    clockIn: '2026-09-20T08:00:00Z',
    clockOut: '2026-09-20T09:00:00Z',
  });
  const refusal = await approve(row.id).catch((error: unknown) => error);
  expect(refusal).toBeInstanceOf(AttendanceChangeKindRefusal);
  expect(refusal).toMatchObject({ code: 'ATTENDANCE_MANUAL_INVALID_TIMES', status: 422 });
  expect(
    await f.h.owner`SELECT status,session_id FROM attendance_change_requests WHERE id=${row.id}`,
  ).toMatchObject([{ status: 'PENDING', session_id: null }]);
  expect(
    await f.h.owner`SELECT id FROM attendance_sessions WHERE change_request_id=${row.id}`,
  ).toHaveLength(0);
});

it('AMS-06 refuses overlapping PENDING ADDs but permits touching ends and self exclusion on approval', async () => {
  const row = await f.fileChange.execute(changeActor(f), terms('2026-09-21'));
  await expect(
    f.fileChange.execute(changeActor(f), {
      ...terms('2026-09-21'),
      clock_in: '2026-09-21T15:59:59.999Z',
    }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_CHANGE_DUPLICATE_PENDING' });
  const next = await f.fileChange.execute(changeActor(f), {
    ...terms('2026-09-21'),
    clock_in: '2026-09-21T16:00:00Z',
    clock_out: '2026-09-21T17:00:00Z',
  });
  expect((await approve(row.id)).status).toBe('APPROVED');
  expect((await approve(next.id)).status).toBe('APPROVED');
});

it('rechecks contract eligibility and timezone snapshots at approval', async () => {
  const row = await f.fileChange.execute(changeActor(f), terms('2026-09-22'));
  await f.h.owner`UPDATE employees SET contract_end='2026-09-21' WHERE id=${f.employee.id}`;
  try {
    await expect(approve(row.id)).rejects.toMatchObject({ code: 'ATTENDANCE_MANUAL_NOT_ELIGIBLE' });
  } finally {
    await f.h.owner`UPDATE employees SET contract_end=NULL WHERE id=${f.employee.id}`;
  }
  await f.h.owner`UPDATE branches SET timezone='UTC' WHERE id=${f.branch}`;
  try {
    await expect(approve(row.id)).rejects.toMatchObject({
      code: 'ATTENDANCE_MANUAL_INVALID_TIMES',
    });
  } finally {
    await f.h.owner`UPDATE branches SET timezone='Asia/Kuwait' WHERE id=${f.branch}`;
  }
  expect(
    await f.h.owner`SELECT status FROM attendance_change_requests WHERE id=${row.id}`,
  ).toMatchObject([{ status: 'PENDING' }]);
});

it('accepts uppercase employee and branch UUIDs using canonical eligibility facts', async () => {
  const row = await f.fileChange.execute(changeActor(f), {
    ...terms('2026-09-28'),
    branch_id: f.branch.toUpperCase(),
    employee_id: f.employee.id.toUpperCase(),
  });
  expect(row).toMatchObject({ status: 'PENDING', branch_id: f.branch });
});

it('excludes its own pending request when approval uses an uppercase UUID', async () => {
  const row = await f.fileChange.execute(changeActor(f), terms('2026-09-29'));
  expect(await approve(row.id.toUpperCase())).toMatchObject({ id: row.id, status: 'APPROVED' });
});

it('accepts approved leave and old dates without reading leave or applying a date floor', async () => {
  const leave = await f.request.execute(
    { ...leaveActor(f), userId: f.approverId },
    leaveTerms('2026-09-23'),
  );
  await f.decide.execute(
    { ...leaveActor(f), userId: f.approverId, leaveId: leave.id },
    { decision: 'APPROVED', expected_revision: leave.revision },
  );
  expect(
    (await f.fileChange.execute(changeActor(f, undefined, f.owner), terms('2026-09-23'))).status,
  ).toBe('APPROVED');
  await f.h.owner`UPDATE employees SET hire_date='2000-01-01' WHERE id=${f.employee.id}`;
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
    VALUES(${f.company},${leaveIds.newId()},${f.business},${f.employee.id},${f.branch},'2000-01-01','2026-01-01')`;
  expect(
    (await f.fileChange.execute(changeActor(f, undefined, f.owner), terms('2001-01-01'))).status,
  ).toBe('APPROVED');
});

it('refuses device actors before the manual kind', async () => {
  const device = await paired(f.h, f.cookie, f.company, f.branch);
  const response = await f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.business}/attendance-change-requests`,
    headers: {
      authorization: `Device ${device.token}`,
      origin,
      'x-company-id': f.company,
      'idempotency-key': leaveIds.newId(),
    },
    payload: terms('2026-09-24'),
  });
  expect(response.statusCode).toBe(403);
  expect(response.json().code).toBe('FORBIDDEN');
});

it('tenant-qualified deferred FK refuses another company request at commit and RLS hides manual sessions', async () => {
  const own = await f.fileChange.execute(changeActor(f, undefined, f.owner), terms('2026-09-25'));
  const [branchB] = await f.h
    .owner`SELECT business_id FROM branches WHERE company_id=${f.otherCompany} AND id=${f.foreignBranch}`;
  if (!branchB) throw new Error('FOREIGN_BRANCH_MISSING');
  const employeeB = leaveIds.newId(),
    requestB = leaveIds.newId(),
    sessionB = leaveIds.newId();
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${f.otherCompany},${employeeB},${branchB.business_id},${f.foreignBranch},'Synthetic foreign manual','synthetic foreign manual','staff','2026-01-01')`;
  await f.h
    .owner`INSERT INTO attendance_change_requests(company_id,id,business_id,branch_id,employee_id,kind,status,reason,requested_by,requested_at,decided_by,decided_at,clock_in,clock_out,working_date,timezone)
    VALUES(${f.otherCompany},${requestB},${branchB.business_id},${f.foreignBranch},${employeeB},'ADD_SESSION','APPROVED','foreign day',${f.userId},now(),${f.userId},now(),'2026-09-26T07:00:00Z','2026-09-26T08:00:00Z','2026-09-26','Asia/Kuwait')`;
  await f.h
    .owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,clock_out,status,source,closed_by,geo,late_minutes,change_request_id)
    VALUES(${f.otherCompany},${sessionB},${branchB.business_id},${f.foreignBranch},${employeeB},'2026-09-26','Asia/Kuwait','2026-09-26T07:00:00Z','2026-09-26T08:00:00Z','CLOSED','MANUAL','MANUAL','NONE',0,${requestB})`;
  expect(
    await f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`SELECT id FROM attendance_sessions WHERE id=${sessionB}`),
    ),
  ).toHaveLength(0);
  expect(
    await f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`SELECT id FROM attendance_sessions WHERE id=${own.session_id}`),
    ),
  ).toHaveLength(0);
  let inserted = false;
  await expect(
    f.db.withTenant(f.company, async (tx) => {
      await tx.execute(sql`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,clock_out,status,source,closed_by,geo,late_minutes,change_request_id)
      VALUES(${f.company},${leaveIds.newId()},${f.business},${f.branch},${f.employee.id},'2026-09-26','Asia/Kuwait','2026-09-26T07:00:00Z','2026-09-26T08:00:00Z','CLOSED','MANUAL','MANUAL','NONE',0,${requestB})`);
      inserted = true;
    }),
  ).rejects.toMatchObject({ code: '23503' });
  expect(inserted).toBe(true);
});

it('ACR-Q13 refuses an ADD_SESSION approval over HTTP with its spec code and keeps the request PENDING', async () => {
  const signed = await f.h.app.inject({
    method: 'POST',
    url: '/v1/auth/sign-in/email',
    headers: { origin: 'http://admin.test' },
    payload: { email: 'employee-owner@example.test', password: 'operator-chosen-pass' },
  });
  const cookies = signed.headers['set-cookie'];
  const ownerCookie = (Array.isArray(cookies) ? cookies : [cookies ?? ''])
    .map((s) => s.split(';')[0])
    .join('; ');
  const row = await f.fileChange.execute(changeActor(f), terms('2026-09-17'));
  await seedSession(f, {
    employeeId: f.employee.id,
    workingDate: '2026-09-17',
    clockIn: '2026-09-17T10:00:00Z',
    clockOut: '2026-09-17T11:00:00Z',
  });
  const response = await f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.business}/attendance-change-requests/${row.id}/decide`,
    headers: { cookie: ownerCookie, 'x-company-id': f.company, 'idempotency-key': leaveIds.newId() },
    payload: { decision: 'APPROVED', revision: 0 },
  });
  expect(response.statusCode).toBe(422);
  expect(response.json()).toMatchObject({
    code: 'ATTENDANCE_MANUAL_INVALID_TIMES',
    message_ar: expect.any(String),
    message_en: expect.any(String),
  });
  expect(
    await f.h.owner`SELECT status,revision,session_id FROM attendance_change_requests WHERE id=${row.id}`,
  ).toEqual([{ status: 'PENDING', revision: 0, session_id: null }]);
  expect(
    await f.h.owner`SELECT id FROM attendance_sessions WHERE change_request_id=${row.id}`,
  ).toHaveLength(0);
});

it('still lets the owner reject a PENDING ADD_SESSION after its branch is deactivated', async () => {
  const row = await f.fileChange.execute(changeActor(f), terms('2026-09-16'));
  await f.h.owner`UPDATE branches SET is_active=false WHERE id=${f.branch}`;
  try {
    await expect(approve(row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await f.decideChange.execute(changeActor(f, row.id, f.owner), {
        decision: 'REJECTED',
        revision: 0,
        reason: 'branch closed',
      }),
    ).toMatchObject({ status: 'REJECTED', session_id: null });
  } finally {
    await f.h.owner`UPDATE branches SET is_active=true WHERE id=${f.branch}`;
  }
});
