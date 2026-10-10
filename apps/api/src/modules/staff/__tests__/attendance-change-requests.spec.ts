import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceChangeRequest, attendanceChangeDecisionResult } from '@pospay/contracts';
import { IdempotencyKeyReusedError } from '@pospay/db';
import { asRole } from './attendance-exception.fixture.ts';
import { linkEmployee, seedSession } from './attendance-correction.fixture.ts';
import {
  attendanceChangeFixture,
  changeActor,
  changeInput,
  changeAudits,
  changeEvents,
  effectCount,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const file = () => f.fileChange.execute(changeActor(f), changeInput(f));
const approve = (id: string, revision = 0) =>
  f.decideChange.execute(changeActor(f, id, f.owner), { decision: 'APPROVED', revision });

it('ACR-01/02 stores pending, audits and owner notice, then atomically applies approval and requester notice', async () => {
  const effects = await effectCount(f);
  const row = attendanceChangeRequest.parse(await file());
  expect(row).toMatchObject({ status: 'PENDING', reason: 'missing attendance', revision: 0 });
  expect(await effectCount(f)).toEqual(effects);
  expect(await changeAudits(f, row.id)).toHaveLength(1);
  expect(await changeEvents(f, row.id)).toMatchObject([
    {
      event_type: 'AttendanceChangeRequested',
      payload: { notification_recipients: [{ user_id: f.owner }] },
    },
  ]);
  expect(attendanceChangeDecisionResult.parse(await approve(row.id))).toMatchObject({
    status: 'APPROVED',
    revision: 1,
    effect: null,
  });
  expect(await effectCount(f)).toHaveLength(effects.length + 1);
  expect(await changeAudits(f, row.id)).toHaveLength(2);
  expect(await changeEvents(f, row.id)).toMatchObject([
    {},
    {
      event_type: 'AttendanceChangeDecided',
      payload: { notification_recipients: [{ user_id: f.approverId }] },
    },
  ]);
  for (const audit of await changeAudits(f, row.id))
    expect(JSON.stringify(audit)).not.toContain('missing attendance');
});
it('ACR-03/04 rejects with a reason and withdraws only for the requester without attendance effects', async () => {
  const effects = await effectCount(f);
  const row = await file();
  const rejected = await f.decideChange.execute(changeActor(f, row.id, f.owner), {
    decision: 'REJECTED',
    revision: 0,
    reason: 'wrong day',
  });
  expect(rejected).toMatchObject({ status: 'REJECTED', decision_reason: 'wrong day' });
  const pending = await file();
  await expect(
    f.cancelChange.execute(changeActor(f, pending.id, f.userId), { revision: 0 }),
  ).rejects.toThrow('NOT_FOUND');
  expect(await f.cancelChange.execute(changeActor(f, pending.id), { revision: 0 })).toMatchObject({
    status: 'CANCELLED',
    revision: 1,
  });
  expect(await changeEvents(f, pending.id)).toHaveLength(1);
  expect(await effectCount(f)).toEqual(effects);
});
it.each(['APPROVED', 'REJECTED', 'CANCELLED'] as const)(
  'ACR-05 refuses all actions on %s',
  async (status) => {
    const row = await file();
    if (status === 'CANCELLED')
      await f.cancelChange.execute(changeActor(f, row.id), { revision: 0 });
    else
      await f.decideChange.execute(changeActor(f, row.id, f.owner), {
        decision: status,
        revision: 0,
        reason: 'decision',
      });
    await expect(f.cancelChange.execute(changeActor(f, row.id), { revision: 0 })).rejects.toThrow(
      'ATTENDANCE_CHANGE_NOT_PENDING',
    );
    for (const decision of ['APPROVED', 'REJECTED'] as const)
      await expect(
        f.decideChange.execute(changeActor(f, row.id, f.owner), {
          decision,
          revision: 0,
          reason: 'decision',
        }),
      ).rejects.toThrow('ATTENDANCE_CHANGE_NOT_PENDING');
  },
);
it('ACR-07 stale revisions change nothing', async () => {
  const row = await file();
  await expect(approve(row.id, 9)).rejects.toThrow('ATTENDANCE_CHANGE_REVISION_CONFLICT');
  await expect(f.cancelChange.execute(changeActor(f, row.id), { revision: 9 })).rejects.toThrow(
    'ATTENDANCE_CHANGE_REVISION_CONFLICT',
  );
  expect(await changeAudits(f, row.id)).toHaveLength(1);
});
it.each(['general_manager', 'business_manager', 'branch_manager'])(
  'ACR-08 refuses %s self attendance',
  async (role) => {
    await asRole(f, role);
    const employee_id = await linkEmployee(f, f.approverId);
    await expect(
      f.fileChange.execute(changeActor(f), { ...changeInput(f), employee_id }),
    ).rejects.toThrow('ATTENDANCE_CHANGE_SELF_FORBIDDEN');
    await f.h.owner`UPDATE employees SET user_id=NULL WHERE id=${employee_id}`;
    await asRole(f, 'business_manager');
  },
);
it('ACR-08 records owner self filing as approved with two audit entries and no recipients', async () => {
  const employee_id = await linkEmployee(f, f.owner);
  const row = await f.fileChange.execute(changeActor(f, undefined, f.owner), {
    ...changeInput(f),
    employee_id,
  });
  expect(row).toMatchObject({
    status: 'APPROVED',
    decided_by: f.owner,
    requested_by: f.owner,
    revision: 1,
  });
  expect((await changeAudits(f, row.id)).map((r) => r['action'])).toEqual([
    'attendance_change.requested',
    'attendance_change.approved',
  ]);
  const events = await changeEvents(f, row.id);
  expect(events).toMatchObject([{ event_type: 'AttendanceChangeDecided' }]);
  expect(events[0]?.['payload']).not.toHaveProperty('notification_recipients');
});
it('ACR-09 non-owner cannot decide and foreign scope cannot resolve ids', async () => {
  const row = await file();
  await expect(
    f.decideChange.execute(changeActor(f, row.id), { decision: 'APPROVED', revision: 0 }),
  ).rejects.toThrow('NOT_FOUND');
  for (const actor of [
    { ...changeActor(f, row.id, f.owner), businessId: f.secondBusiness },
    { ...changeActor(f, row.id, f.owner), companyId: f.otherCompany },
  ])
    await expect(
      f.decideChange.execute(actor, { decision: 'APPROVED', revision: 0 }),
    ).rejects.toThrow('NOT_FOUND');
});
it('ACR-11 replays each write and rejects fingerprint reuse', async () => {
  const actor = changeActor(f);
  const row = await f.fileChange.execute(actor, changeInput(f));
  expect(await f.fileChange.execute(actor, changeInput(f))).toEqual(row);
  await expect(
    f.fileChange.execute({ ...actor, fingerprint: 'different' }, changeInput(f)),
  ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  for (const action of ['cancel', 'decide'] as const) {
    const pending = await file();
    const who = changeActor(f, pending.id, action === 'decide' ? f.owner : f.approverId);
    const run = (fingerprint: string) =>
      action === 'cancel'
        ? f.cancelChange.execute({ ...who, fingerprint }, { revision: 0 })
        : f.decideChange.execute({ ...who, fingerprint }, { decision: 'APPROVED', revision: 0 });
    const first = await run(who.fingerprint);
    expect(await run(who.fingerprint)).toEqual(first);
    await expect(run('different')).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
    expect(await changeAudits(f, pending.id)).toHaveLength(2);
  }
});
it('ACR-13/14 approval refusal or a failed effect rolls back and leaves PENDING', async () => {
  const row = await file();
  const effects = await effectCount(f);
  for (const flag of ['refuse', 'failAfterEffect'] as const) {
    f.control[flag] = true;
    try {
      await expect(approve(row.id)).rejects.toThrow('VALIDATION_FAILED');
    } finally {
      f.control[flag] = false;
    }
    expect(
      await f.h.owner`SELECT status,revision FROM attendance_change_requests WHERE id=${row.id}`,
    ).toEqual([{ status: 'PENDING', revision: 0 }]);
    expect(await effectCount(f)).toEqual(effects);
    expect(await changeAudits(f, row.id)).toHaveLength(1);
    expect(await changeEvents(f, row.id)).toHaveLength(1);
  }
});
it('allows only one pending void and maps the partial UNIQUE refusal', async () => {
  const session_id = await seedSession(f, { employeeId: f.employee.id });
  const input = {
    ...changeInput(f),
    kind: 'VOID_SESSION' as const,
    session_id,
    session_revision: 0,
  };
  await f.fileChange.execute(changeActor(f), input);
  await expect(f.fileChange.execute(changeActor(f), input)).rejects.toThrow(
    'ATTENDANCE_CHANGE_DUPLICATE_PENDING',
  );
});
