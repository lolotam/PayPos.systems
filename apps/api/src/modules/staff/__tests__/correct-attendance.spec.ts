import { afterAll, beforeAll, expect, it } from 'vitest';
import { IdempotencyKeyReusedError } from '@pospay/db';
import { correctAttendanceResult } from '@pospay/contracts';
import { asRole } from './attendance-exception.fixture.ts';
import { leaveIds } from './leave.fixture.ts';
import {
  attendanceCorrectionFixture,
  correctionActor,
  correctionInput,
  correctionRows,
  correctionAudits,
  seedSession,
  linkEmployee,
  ownerUserId,
  sessionRow,
  type AttendanceCorrectionFixture,
} from './attendance-correction.fixture.ts';
import { createAttendanceCorrectionTransactions } from '../persistence/drizzle-attendance-correction-transactions.ts';
import { CorrectAttendanceUseCase } from '../use-cases/correct-attendance/correct-attendance.usecase.ts';

let f: AttendanceCorrectionFixture;
beforeAll(async () => {
  f = await attendanceCorrectionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('CA-01 corrects MISSED_OUT with one immutable history row and audit, without an event', async () => {
  const session = await seedSession(f, { status: 'MISSED_OUT', closedBy: 'MISSED_OUT' });
  const result = await f.correct.execute(correctionActor(f, session), correctionInput());
  expect(correctAttendanceResult.parse(result).session).toMatchObject({
    status: 'MISSED_OUT',
    closed_by: 'MISSED_OUT',
    revision: 1,
    clock_out: '2026-10-04T09:00:00.000Z',
  });
  expect(await correctionRows(f, session)).toMatchObject([
    {
      field: 'CLOCK_OUT',
      before_at: '2026-10-04T08:00:00.000Z',
      after_at: '2026-10-04T09:00:00.000Z',
      reason: 'wrong scan time',
      corrected_by: f.approverId,
    },
  ]);
  expect(await correctionAudits(f, session)).toHaveLength(1);
  expect(
    await f.h.owner`SELECT id FROM outbox WHERE payload->>'session_id'=${session}`,
  ).toHaveLength(0);
});

it('CA-02 uses the clock-in schedule snapshot to recompute lateness', async () => {
  const session = await seedSession(f, { scheduledStart: '2026-10-04T04:20:00Z' });
  const result = await f.correct.execute(correctionActor(f, session), {
    revision: 0,
    reason: 'arrived earlier',
    clock_in: '2026-10-04T04:25:00Z',
  });
  expect(result.session.late_minutes).toBe(0);
  expect(result.corrections.map((row) => row.field)).toEqual(['CLOCK_IN']);
  expect(await correctionAudits(f, session)).toMatchObject([
    {
      before: { late_minutes: 40 },
      after: { late_minutes: 0 },
    },
  ]);
});

it('CA-03 changes both fields with a shared request, actor, timestamp and single audit', async () => {
  const session = await seedSession(f);
  const result = await f.correct.execute(
    correctionActor(f, session),
    correctionInput(0, {
      clock_in: '2026-10-04T04:25:00Z',
    }),
  );
  expect(result.corrections.map((row) => row.field)).toEqual(['CLOCK_IN', 'CLOCK_OUT']);
  const rows = await correctionRows(f, session);
  expect(rows).toHaveLength(2);
  expect(rows[0]?.['request_id']).toBe(rows[1]?.['request_id']);
  expect(result.corrections.every((row) => row.corrected_at === f.clock.now().toISOString())).toBe(
    true,
  );
  const audit = await f.h
    .owner`SELECT id, actor_user_id, after FROM audit_log WHERE id=${rows[0]?.['request_id'] as string}`;
  expect(audit).toMatchObject([
    { actor_user_id: f.approverId, after: { reason: 'wrong scan time' } },
  ]);
  expect(await correctionAudits(f, session)).toHaveLength(1);
});

it('CA-04 refuses OPEN before revision and writes nothing', async () => {
  const session = await seedSession(f, { status: 'OPEN', clockOut: null, closedBy: null });
  await expect(f.correct.execute(correctionActor(f, session), correctionInput(7))).rejects.toThrow(
    'ATTENDANCE_SESSION_OPEN',
  );
  expect(await correctionRows(f, session)).toHaveLength(0);
  expect(await sessionRow(f, session)).toMatchObject([{ status: 'OPEN', revision: 0 }]);
});

it('CA-05 canonical company Owner can correct their own session', async () => {
  const owner = await ownerUserId(f);
  const session = await seedSession(f, { employeeId: await linkEmployee(f, owner) });
  expect(
    (await f.correct.execute(correctionActor(f, session, owner), correctionInput())).session
      .revision,
  ).toBe(1);
});

it.each(['general_manager', 'business_manager', 'branch_manager'])(
  'CA-05 %s cannot correct their own session',
  async (role) => {
    await asRole(f, role);
    const session = await seedSession(f, { employeeId: await linkEmployee(f, f.approverId) });
    await expect(f.correct.execute(correctionActor(f, session), correctionInput())).rejects.toThrow(
      'ATTENDANCE_CORRECTION_SELF_FORBIDDEN',
    );
    expect(await correctionRows(f, session)).toHaveLength(0);
    await f.h
      .owner`UPDATE employees SET user_id=NULL WHERE id=(SELECT employee_id FROM attendance_sessions WHERE id=${session})`;
  },
);

it('CA-06 hides another branch, business, company and a missing session', async () => {
  await asRole(f, 'branch_manager');
  const session = await seedSession(f, { branchId: f.secondBranch });
  const actors = [
    correctionActor(f, session),
    correctionActor(f, leaveIds.newId()),
    { ...correctionActor(f, session), businessId: f.secondBusiness },
    { ...correctionActor(f, session), companyId: f.otherCompany },
  ];
  for (const actor of actors)
    await expect(f.correct.execute(actor, correctionInput())).rejects.toThrow('NOT_FOUND');
  expect(await correctionRows(f, session)).toHaveLength(0);
  await asRole(f, 'business_manager');
});

it('CA-08 stale revision wins over a no-op and exactly one concurrent correction commits', async () => {
  const session = await seedSession(f);
  const results = await Promise.allSettled([
    f.correct.execute(correctionActor(f, session), correctionInput()),
    f.correct.execute(correctionActor(f, session), correctionInput()),
  ]);
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((row) => row.status === 'rejected')).toMatchObject({
    reason: { code: 'ATTENDANCE_SESSION_REVISION_CONFLICT' },
  });
  expect(await correctionRows(f, session)).toHaveLength(1);
  expect(await correctionAudits(f, session)).toHaveLength(1);
});

it('CA-10 replays without extra history and refuses a changed fingerprint', async () => {
  const session = await seedSession(f);
  const actor = correctionActor(f, session);
  const first = await f.correct.execute(actor, correctionInput());
  expect(await f.correct.execute(actor, correctionInput())).toEqual(first);
  await expect(
    f.correct.execute({ ...actor, fingerprint: 'different' }, correctionInput(1)),
  ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  expect(await correctionRows(f, session)).toHaveLength(1);
  expect(await correctionAudits(f, session)).toHaveLength(1);
});

it('CA-11 preserves every scan fact and exception, including a card operator', async () => {
  const session = await seedSession(f, { source: 'BARCODE', outOperatorId: f.approverId });
  await f.h
    .owner`INSERT INTO attendance_exceptions(company_id,id,business_id,branch_id,employee_id,session_id,kind,raised_at)
    SELECT company_id,${leaveIds.newId()},business_id,branch_id,employee_id,id,'NONE',clock_in FROM attendance_sessions WHERE id=${session}`;
  const facts = () =>
    f.h
      .owner`SELECT to_jsonb(s)-'clock_in'-'clock_out'-'late_minutes'-'revision' AS facts FROM attendance_sessions s WHERE id=${session}`;
  const exceptions = () =>
    f.h.owner`SELECT * FROM attendance_exceptions WHERE session_id=${session}`;
  const before = await facts(),
    warnings = await exceptions();
  await f.correct.execute(correctionActor(f, session), correctionInput());
  expect(await facts()).toEqual(before);
  expect(await exceptions()).toEqual(warnings);
});

it('CA-12 refuses overlapping neighbours across branches, including OPEN, while allowing touching ends', async () => {
  const employeeId = await linkEmployee(f, null);
  const session = await seedSession(f, { employeeId });
  await seedSession(f, {
    employeeId,
    branchId: f.secondBranch,
    clockIn: '2026-10-04T09:00:00Z',
    clockOut: null,
    status: 'OPEN',
    closedBy: null,
  });
  await expect(
    f.correct.execute(
      correctionActor(f, session),
      correctionInput(0, { clock_out: '2026-10-04T09:00:00.001Z' }),
    ),
  ).rejects.toThrow('ATTENDANCE_CORRECTION_INVALID_TIMES');
  expect(
    (await f.correct.execute(correctionActor(f, session), correctionInput())).session.revision,
  ).toBe(1);
});

it.each(['2026-10-04T10:00:00.001Z', '2026-10-04T05:00:00Z', '2026-10-04T04:00:00Z'])(
  'CA-12 refuses future or unordered time %s',
  async (clock_out) => {
    const session = await seedSession(f);
    await expect(
      f.correct.execute(correctionActor(f, session), correctionInput(0, { clock_out })),
    ).rejects.toThrow('ATTENDANCE_CORRECTION_INVALID_TIMES');
    expect(await correctionRows(f, session)).toHaveLength(0);
  },
);

it('CA-12/13 refuses over sixteen hours and moving the clock-in to another stored working date', async () => {
  const session = await seedSession(f, {
    workingDate: '2026-10-03',
    clockIn: '2026-10-03T05:00:00Z',
    clockOut: '2026-10-03T08:00:00Z',
  });
  await expect(
    f.correct.execute(
      correctionActor(f, session),
      correctionInput(0, { clock_out: '2026-10-03T21:00:00.001Z' }),
    ),
  ).rejects.toThrow('ATTENDANCE_CORRECTION_INVALID_TIMES');
  await expect(
    f.correct.execute(correctionActor(f, session), {
      revision: 0,
      reason: 'midnight',
      clock_in: '2026-10-02T20:59:59.999Z',
    }),
  ).rejects.toThrow('ATTENDANCE_CORRECTION_WORKING_DATE');
});

it('CA-15 retains earlier rows when corrected twice', async () => {
  const session = await seedSession(f);
  await f.correct.execute(correctionActor(f, session), correctionInput());
  const first = await correctionRows(f, session);
  await f.correct.execute(
    correctionActor(f, session),
    correctionInput(1, { clock_out: '2026-10-04T09:30:00Z' }),
  );
  const rows = await correctionRows(f, session);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual(first[0]);
  expect(rows[1]).toMatchObject({
    before_at: '2026-10-04T09:00:00.000Z',
    after_at: '2026-10-04T09:30:00.000Z',
  });
});

it('CA-16 accepts an old session inside approved leave without modifying leave', async () => {
  const employeeId = await linkEmployee(f, null);
  const session = await seedSession(f, {
    employeeId,
    workingDate: '2026-02-01',
    clockIn: '2026-02-01T05:00:00Z',
    clockOut: '2026-02-01T08:00:00Z',
  });
  const leave = leaveIds.newId();
  await f.h
    .owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",timezone,starts_at,ends_at,type,status,requested_by,requested_at,decided_by,decided_at)
    VALUES(${f.company},${leave},${f.business},${f.branch},${employeeId},'FULL_DAY','2026-02-01','2026-02-01','Asia/Kuwait','2026-01-31T21:00:00Z','2026-02-01T21:00:00Z','ANNUAL','APPROVED',${f.userId},'2026-01-01',${f.approverId},'2026-01-02')`;
  const before = await f.h.owner`SELECT * FROM leave_requests WHERE id=${leave}`;
  expect(
    (
      await f.correct.execute(
        correctionActor(f, session),
        correctionInput(0, { clock_out: '2026-02-01T09:00:00Z' }),
      )
    ).session.revision,
  ).toBe(1);
  expect(await f.h.owner`SELECT * FROM leave_requests WHERE id=${leave}`).toEqual(before);
});

it('rolls back session, corrections, audit and idempotency when audit insertion fails', async () => {
  const session = await seedSession(f);
  const actor = correctionActor(f, session);
  const duplicate = leaveIds.newId();
  await f.h
    .owner`INSERT INTO audit_log(company_id,id,entity,entity_id,action) VALUES(${f.company},${duplicate},'attendance_session',${session},'synthetic.failure')`;
  const tx = createAttendanceCorrectionTransactions(f.db, { newId: () => duplicate });
  await expect(
    new CorrectAttendanceUseCase(tx, f.clock).execute(actor, correctionInput()),
  ).rejects.toThrow('ATTENDANCE_CORRECTION_PERSISTENCE_FAILED');
  expect(await sessionRow(f, session)).toMatchObject([{ revision: 0 }]);
  expect(await correctionRows(f, session)).toHaveLength(0);
  expect(await correctionAudits(f, session)).toHaveLength(0);
  expect(await f.h.owner`SELECT key FROM idempotency_keys WHERE key=${actor.key}`).toHaveLength(0);
});

it('DENY and expired membership refuse before history is written', async () => {
  const session = await seedSession(f);
  const override = leaveIds.newId();
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${override},${f.approverMember},'correct:attendance:branch','DENY','BRANCH',${f.branch},'Synthetic deny',${f.userId})`;
  await expect(f.correct.execute(correctionActor(f, session), correctionInput())).rejects.toThrow(
    'NOT_FOUND',
  );
  await f.h.owner`DELETE FROM permission_overrides WHERE id=${override}`;
  await f.h
    .owner`UPDATE memberships SET ends_at='2026-10-04T10:00:00Z' WHERE id=${f.approverMember}`;
  await expect(f.correct.execute(correctionActor(f, session), correctionInput())).rejects.toThrow(
    'NOT_FOUND',
  );
  await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE id=${f.approverMember}`;
  expect(await correctionRows(f, session)).toHaveLength(0);
});

it('a custom role named owner with personal ALLOW never gains the self exception', async () => {
  const role = leaveIds.newId(),
    override = leaveIds.newId();
  await f.h
    .owner`INSERT INTO roles(id,company_id,code,name_en) VALUES(${role},${f.company},'owner','Synthetic owner')`;
  await f.h
    .owner`UPDATE memberships SET role_id=${role},role_owner_key=${f.company},scope_type='COMPANY',scope_id=${f.company} WHERE id=${f.approverMember}`;
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${override},${f.approverMember},'correct:attendance:branch','ALLOW','BRANCH',${f.branch},'Synthetic grant',${f.userId})`;
  const session = await seedSession(f, { employeeId: await linkEmployee(f, f.approverId) });
  await expect(f.correct.execute(correctionActor(f, session), correctionInput())).rejects.toThrow(
    'ATTENDANCE_CORRECTION_SELF_FORBIDDEN',
  );
  const other = await seedSession(f);
  expect(
    (await f.correct.execute(correctionActor(f, other), correctionInput())).session.revision,
  ).toBe(1);
  await f.h.owner`DELETE FROM permission_overrides WHERE id=${override}`;
  await f.h
    .owner`UPDATE memberships SET role_owner_key='global',role_id=(SELECT id FROM roles WHERE code='business_manager' AND company_id IS NULL),scope_type='BUSINESS',scope_id=${f.business} WHERE id=${f.approverMember}`;
});
