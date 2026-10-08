import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { IdempotencyKeyReusedError, SYSTEM_ROLES } from '@pospay/db';
import {
  asRole,
  attendanceExceptionFixture,
  decision,
  exceptionActor,
  exceptionAudits,
  exceptionFact,
  openException,
  sessionFact,
  type AttendanceExceptionFixture,
} from './attendance-exception.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

const MIGRATION = new URL(
  '../../../../../../packages/db/migrations/0088_2026-10-08_resolve-attendance-exception.sql',
  import.meta.url,
);
let f: AttendanceExceptionFixture;
beforeAll(async () => {
  f = await attendanceExceptionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('RAE-01 branch manager resolves an open out-of-range warning and writes one audit', async () => {
  await asRole(f, 'branch_manager');
  const seeded = await openException(f, 'OUT_OF_RANGE');
  const resolved = await f.resolve.execute(exceptionActor(f, seeded.id), decision());
  expect(resolved).toMatchObject({
    id: seeded.id,
    session_id: seeded.sessionId,
    kind: 'OUT_OF_RANGE',
    status: 'RESOLVED',
    resolution: 'ACKNOWLEDGED',
    resolved_by: f.approverId,
    resolved_at: f.clock.now().toISOString(),
    reason: 'errand for the shop',
    revision: 1,
  });
  const audits = await exceptionAudits(f, seeded.id);
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    action: 'attendance_exception.resolved',
    before: { status: 'OPEN', resolution: null, reason: null, revision: 0 },
    after: {
      status: 'RESOLVED',
      resolution: 'ACKNOWLEDGED',
      resolved_by: f.approverId,
      reason: 'errand for the shop',
      decision_reason: 'errand for the shop',
      revision: 1,
    },
  });
  expect(
    await f.h
      .owner`SELECT id FROM outbox WHERE company_id=${f.company} AND aggregate_id=${seeded.id}`,
  ).toHaveLength(0);
});

it('RAE-02 business manager resolves an open none warning', async () => {
  await asRole(f, 'business_manager');
  const seeded = await openException(f, 'NONE');
  expect(await f.resolve.execute(exceptionActor(f, seeded.id), decision())).toMatchObject({
    kind: 'NONE',
    status: 'RESOLVED',
    resolution: 'ACKNOWLEDGED',
    resolved_by: f.approverId,
    revision: 1,
  });
});

it.each(['owner', 'general_manager'])('RAE-01 %s resolves within company scope', async (code) => {
  await asRole(f, code);
  const seeded = await openException(f, 'NONE');
  expect((await f.resolve.execute(exceptionActor(f, seeded.id), decision())).status).toBe(
    'RESOLVED',
  );
});

it('RAE-03 reopen then resolve again writes three audits and clears the closure', async () => {
  await asRole(f, 'business_manager');
  const seeded = await openException(f, 'NONE');
  await f.resolve.execute(exceptionActor(f, seeded.id), decision());
  const reopened = await f.reopen.execute(exceptionActor(f, seeded.id), decision(1, ' mistake '));
  expect(reopened).toMatchObject({
    status: 'OPEN',
    resolution: null,
    resolved_by: null,
    resolved_at: null,
    reason: null,
    revision: 2,
  });
  await f.resolve.execute(exceptionActor(f, seeded.id), decision(2, 'confirmed'));
  const audits = await exceptionAudits(f, seeded.id);
  expect(audits.map((row) => row['action'])).toEqual([
    'attendance_exception.resolved',
    'attendance_exception.reopened',
    'attendance_exception.resolved',
  ]);
  expect(audits[1]?.['before']).toMatchObject({ reason: 'errand for the shop', revision: 1 });
  expect(audits[1]?.['after']).toMatchObject({
    reason: null,
    decision_reason: 'mistake',
    revision: 2,
  });
});

it('RAE-04 refuses suspected missed-out on resolve and reopen without changing the row', async () => {
  await asRole(f, 'business_manager');
  const seeded = await openException(f, 'SUSPECTED_MISSED_OUT');
  const before = await exceptionFact(f, seeded.id);
  await expect(f.resolve.execute(exceptionActor(f, seeded.id), decision())).rejects.toThrow(
    'ATTENDANCE_EXCEPTION_NOT_MANUAL',
  );
  await expect(f.reopen.execute(exceptionActor(f, seeded.id), decision())).rejects.toThrow(
    'ATTENDANCE_EXCEPTION_NOT_MANUAL',
  );
  expect(await exceptionFact(f, seeded.id)).toEqual(before);
  expect(await exceptionAudits(f, seeded.id)).toHaveLength(0);
});

it('RAE-05 refuses the owner acting on their own attendance, including a second membership', async () => {
  const role = SYSTEM_ROLES.find((entry) => entry.code === 'owner');
  await f.h
    .owner`UPDATE memberships SET role_id=${role?.id as string},scope_type='COMPANY',scope_id=${f.company} WHERE id=${f.memberId}`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES(${f.company},${leaveIds.newId()},${f.userId},${role?.id as string},'global','BUSINESS',${f.business},'2026-01-01')`;
  const seeded = await openException(f, 'OUT_OF_RANGE');
  await expect(
    f.resolve.execute(exceptionActor(f, seeded.id, f.userId), decision()),
  ).rejects.toThrow('ATTENDANCE_EXCEPTION_SELF_FORBIDDEN');
  expect(await exceptionFact(f, seeded.id)).toMatchObject([{ status: 'OPEN', revision: 0 }]);
});

it('RAE-06 a branch manager of another branch is not found, same as a missing id', async () => {
  await asRole(f, 'branch_manager');
  const seeded = await openException(f, 'NONE', f.secondBranch);
  await expect(f.resolve.execute(exceptionActor(f, seeded.id), decision())).rejects.toThrow(
    'NOT_FOUND',
  );
  await expect(
    f.resolve.execute(exceptionActor(f, leaveIds.newId()), decision()),
  ).rejects.toThrow('NOT_FOUND');
  expect(await exceptionFact(f, seeded.id)).toMatchObject([{ status: 'OPEN', revision: 0 }]);
});

it('RAE-08 stale revision, double resolve and reopening an open row conflict and change nothing', async () => {
  await asRole(f, 'business_manager');
  const seeded = await openException(f, 'OUT_OF_RANGE');
  await f.resolve.execute(exceptionActor(f, seeded.id), decision());
  await expect(f.resolve.execute(exceptionActor(f, seeded.id), decision())).rejects.toThrow(
    'ATTENDANCE_EXCEPTION_REVISION_CONFLICT',
  );
  await expect(f.resolve.execute(exceptionActor(f, seeded.id), decision(9))).rejects.toThrow(
    'ATTENDANCE_EXCEPTION_REVISION_CONFLICT',
  );
  const open = await openException(f, 'NONE');
  await expect(f.reopen.execute(exceptionActor(f, open.id), decision())).rejects.toThrow(
    'ATTENDANCE_EXCEPTION_REVISION_CONFLICT',
  );
  await f.h.owner`UPDATE attendance_exceptions SET revision=2147483647 WHERE id=${open.id}`;
  await expect(
    f.resolve.execute(exceptionActor(f, open.id), decision(2147483647)),
  ).rejects.toThrow('ATTENDANCE_EXCEPTION_REVISION_CONFLICT');
  expect(await exceptionFact(f, seeded.id)).toMatchObject([{ revision: 1 }]);
  expect(await exceptionFact(f, open.id)).toMatchObject([{ status: 'OPEN', revision: 2147483647 }]);
});

it('RAE-09 exactly one of two concurrent resolves wins', async () => {
  await asRole(f, 'business_manager');
  const seeded = await openException(f, 'OUT_OF_RANGE');
  const results = await Promise.allSettled([
    f.resolve.execute(exceptionActor(f, seeded.id), decision(0, 'first')),
    f.resolve.execute(exceptionActor(f, seeded.id), decision(0, 'second')),
  ]);
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  const failure = results.find((row) => row.status === 'rejected');
  expect(failure?.status === 'rejected' ? failure.reason.code : null).toBe(
    'ATTENDANCE_EXCEPTION_REVISION_CONFLICT',
  );
  expect(await exceptionAudits(f, seeded.id)).toHaveLength(1);
  expect(await exceptionFact(f, seeded.id)).toMatchObject([{ status: 'RESOLVED', revision: 1 }]);
});

it('RAE-10 replays the same key and refuses the key with another fingerprint', async () => {
  await asRole(f, 'business_manager');
  const seeded = await openException(f, 'NONE');
  const key = leaveIds.newId();
  const first = await f.resolve.execute(
    exceptionActor(f, seeded.id, f.approverId, key, key),
    decision(),
  );
  expect(
    await f.resolve.execute(exceptionActor(f, seeded.id, f.approverId, key, key), decision()),
  ).toEqual(first);
  await expect(
    f.resolve.execute(
      exceptionActor(f, seeded.id, f.approverId, key, leaveIds.newId()),
      decision(0, 'different'),
    ),
  ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  expect(await exceptionAudits(f, seeded.id)).toHaveLength(1);
});

it('RAE-11 resolving and reopening leaves the session times and lateness unchanged', async () => {
  await asRole(f, 'business_manager');
  const seeded = await openException(f, 'OUT_OF_RANGE');
  const before = await sessionFact(f, seeded.sessionId);
  await f.resolve.execute(exceptionActor(f, seeded.id), decision());
  await f.reopen.execute(exceptionActor(f, seeded.id), decision(1));
  expect(await sessionFact(f, seeded.sessionId)).toEqual(before);
});

it('an in-scope deny is not found and does not change the row', async () => {
  await asRole(f, 'business_manager');
  const seeded = await openException(f, 'NONE');
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${leaveIds.newId()},${f.approverMember},'resolve:attendance:branch','DENY','BRANCH',${f.branch},'Synthetic refusal',${f.userId})`;
  await expect(f.resolve.execute(exceptionActor(f, seeded.id), decision())).rejects.toThrow(
    'NOT_FOUND',
  );
  await f.h.owner`DELETE FROM permission_overrides WHERE membership_id=${f.approverMember}`;
  expect(await exceptionFact(f, seeded.id)).toMatchObject([{ status: 'OPEN', revision: 0 }]);
});

it('RAE-14 migration cleanup closes card-raised none rows and leaves QR rows open', async () => {
  const statements = (await readFile(MIGRATION, 'utf8')).split('--> statement-breakpoint');
  const cleanup = statements.find((statement) => statement.includes('UPDATE') && statement.includes('CARD_SCAN'));
  const cardIn = await plant(f, 'BARCODE', false, null);
  const cardInNone = await warn(f, cardIn, 'NONE', 'in');
  const mixed = await plant(f, 'QR', true, f.approverId);
  const qrIn = await warn(f, mixed, 'NONE', 'in');
  const cardOut = await warn(f, mixed, 'NONE', 'out');
  const qrOut = await plant(f, 'QR', true, null);
  const qrOutNone = await warn(f, qrOut, 'NONE', 'out');
  const suspectedSession = await plant(f, 'BARCODE', false, null);
  const suspected = await warn(f, suspectedSession, 'SUSPECTED_MISSED_OUT', 'in');
  const outsideSession = await plant(f, 'BARCODE', false, null);
  const outside = await warn(f, outsideSession, 'OUT_OF_RANGE', 'in');
  await f.h.owner.unsafe(cleanup ?? '');
  const rows = await f.h
    .owner`SELECT id,status,resolution,resolved_by IS NULL AS unresolved,reason IS NULL AS no_reason,resolved_at IS NOT NULL AS stamped
    FROM attendance_exceptions WHERE id IN (${cardInNone},${qrIn},${cardOut},${qrOutNone},${suspected},${outside})`;
  const byId = new Map(rows.map((row) => [row['id'], row]));
  expect(byId.get(cardInNone)).toMatchObject({
    status: 'RESOLVED',
    resolution: 'CARD_SCAN',
    unresolved: true,
    no_reason: true,
    stamped: true,
  });
  expect(byId.get(cardOut)).toMatchObject({ status: 'RESOLVED', resolution: 'CARD_SCAN' });
  for (const id of [qrIn, qrOutNone, suspected, outside])
    expect(byId.get(id)).toMatchObject({ status: 'OPEN', resolution: null });
});

async function plant(
  fx: AttendanceExceptionFixture,
  source: 'QR' | 'BARCODE',
  closed: boolean,
  operator: string | null,
) {
  const id = leaveIds.newId();
  const clockIn = '2026-10-01T08:00:00Z';
  const clockOut = '2026-10-01T12:00:00Z';
  if (!closed) {
    await fx.h
      .owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,clock_out,status,source,closed_by,geo,out_geo,late_minutes)
      VALUES(${fx.company},${id},${fx.business},${fx.branch},${fx.employee.id},'2026-10-01','Asia/Kuwait',${clockIn},'2026-10-01T09:00:00Z','CLOSED',${source},'EMPLOYEE','NONE','NONE',0)`;
    return id;
  }
  await fx.h
    .owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,clock_out,status,source,closed_by,geo,out_geo,late_minutes,out_operator_id)
    VALUES(${fx.company},${id},${fx.business},${fx.branch},${fx.employee.id},'2026-10-01','Asia/Kuwait',${clockIn},${clockOut},'CLOSED',${source},'EMPLOYEE','NONE','NONE',0,${operator})`;
  return id;
}
async function warn(
  fx: AttendanceExceptionFixture,
  sessionId: string,
  kind: 'NONE' | 'OUT_OF_RANGE' | 'SUSPECTED_MISSED_OUT',
  at: 'in' | 'out',
) {
  const id = leaveIds.newId();
  const raised = at === 'in' ? '2026-10-01T08:00:00Z' : '2026-10-01T12:00:00Z';
  await fx.h
    .owner`INSERT INTO attendance_exceptions(company_id,id,business_id,employee_id,branch_id,session_id,kind,raised_at)
    VALUES(${fx.company},${id},${fx.business},${fx.employee.id},${fx.branch},${sessionId},${kind},${raised})`;
  return id;
}
