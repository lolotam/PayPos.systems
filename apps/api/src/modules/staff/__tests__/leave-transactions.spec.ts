import { afterAll, beforeAll, expect, it } from 'vitest';
import { leaveRequest } from '@pospay/contracts';
import {
  leaveActor,
  leaveFixture,
  leaveIds,
  leaveTerms,
  type LeaveFixture,
} from './leave.fixture.ts';
let f: LeaveFixture;
beforeAll(async () => {
  f = await leaveFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('creates stable UTC periods and replays once with audit/outbox free of sensitive notes', async () => {
  const actor = leaveActor(f);
  const terms = { ...leaveTerms(), type: 'OTHER' as const, note: ' Synthetic health note ' };
  const result = leaveRequest.parse(await f.request.execute(actor, terms));
  expect(result).toMatchObject({
    status: 'PENDING',
    revision: 1,
    timezone: 'Asia/Kuwait',
    starts_at: '2026-12-31T21:00:00.000Z',
    ends_at: '2027-01-01T21:00:00.000Z',
    note: 'Synthetic health note',
  });
  expect(await f.request.execute(actor, terms)).toEqual(result);
  const events = await f.h
    .owner`SELECT payload FROM outbox WHERE company_id=${f.company} AND event_type='LeaveRequested' AND payload->>'id'=${result.id}`;
  const audit = await f.h
    .owner`SELECT after FROM audit_log WHERE company_id=${f.company} AND entity_id=${result.id}`;
  expect(events).toHaveLength(1);
  expect(audit).toHaveLength(1);
  expect(JSON.stringify([events, audit])).not.toContain('Synthetic health note');
  await expect(
    f.request.execute({ ...actor, fingerprint: 'changed' }, terms),
  ).rejects.toMatchObject({ name: 'IdempotencyKeyReusedError' });
  const [owner] = await f.h.owner`SELECT id FROM "user" WHERE email='employee-owner@example.test'`;
  await expect(
    f.request.execute({ ...actor, userId: owner?.['id'] as string }, terms),
  ).rejects.toMatchObject({ name: 'IdempotencyKeyReusedError' });
});
it('serializes concurrent overlaps across branches and cancels/replays exactly once', async () => {
  const outcomes = await Promise.allSettled([
    f.request.execute(leaveActor(f), leaveTerms('2027-02-01', '2027-02-02')),
    f.request.execute(
      { ...leaveActor(f), branchId: f.secondBranch },
      leaveTerms('2027-02-02', '2027-02-03'),
    ),
  ]);
  expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = outcomes.find((r) => r.status === 'rejected');
  expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
    code: 'LEAVE_OVERLAP',
  });
  const made = outcomes.find((r) => r.status === 'fulfilled');
  if (made?.status !== 'fulfilled') throw new Error('Expected created leave');
  const actor = { ...leaveActor(f), leaveId: made.value.id };
  const cancelled = await f.cancel.execute(actor, { expected_revision: 1 });
  expect(cancelled).toMatchObject({ status: 'CANCELLED', revision: 2, cancelled_by: f.userId });
  expect(await f.cancel.execute(actor, { expected_revision: 1 })).toEqual(cancelled);
  await expect(
    f.cancel.execute({ ...actor, key: leaveIds.newId() }, { expected_revision: 2 }),
  ).rejects.toMatchObject({ code: 'LEAVE_NOT_PENDING' });
  expect(
    await f.h
      .owner`SELECT id FROM outbox WHERE company_id=${f.company} AND event_type='LeaveCancelled' AND payload->>'id'=${made.value.id}`,
  ).toHaveLength(1);
  await expect(
    f.request.execute(leaveActor(f), leaveTerms('2027-02-01', '2027-02-03')),
  ).resolves.toMatchObject({ status: 'PENDING' });
});
it('checks current authority before replay and refuses wrong branch/employee/tenant uniformly', async () => {
  const actor = leaveActor(f);
  await f.request.execute(actor, leaveTerms('2027-03-01'));
  for (const changes of [
    { employeeId: leaveIds.newId() },
    { branchId: f.otherBranch },
    { companyId: f.otherCompany },
  ])
    await expect(
      f.request.execute({ ...leaveActor(f), ...changes }, leaveTerms('2027-03-02')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by) VALUES(${f.company},${leaveIds.newId()},${f.memberId},'create:leave:branch','DENY','BRANCH',${f.branch},'Synthetic revoked',${f.userId})`;
  await expect(f.request.execute(actor, leaveTerms('2027-03-01'))).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND permission_code='create:leave:branch'`;
});
it('validates future service coverage, own past policy and real requester cancellation', async () => {
  const own = { ...leaveActor(f), own: true };
  await expect(f.request.execute(own, leaveTerms('2026-10-03'))).rejects.toMatchObject({
    code: 'LEAVE_PAST_OWN_FORBIDDEN',
  });
  const past = await f.request.execute(leaveActor(f), {
    ...leaveTerms('2026-10-03'),
    type: 'SICK',
  });
  await expect(
    f.cancel.execute(
      { ...leaveActor(f), own: true, userId: leaveIds.newId(), leaveId: past.id },
      { expected_revision: 1 },
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await f.h
    .owner`UPDATE employees SET contract_end='2027-04-01' WHERE company_id=${f.company} AND id=${f.employee.id}`;
  await expect(
    f.request.execute(leaveActor(f), leaveTerms('2027-04-01', '2027-04-02')),
  ).rejects.toMatchObject({ code: 'LEAVE_EMPLOYEE_INELIGIBLE' });
  await f.h
    .owner`UPDATE employees SET contract_end=NULL WHERE company_id=${f.company} AND id=${f.employee.id}`;
});
