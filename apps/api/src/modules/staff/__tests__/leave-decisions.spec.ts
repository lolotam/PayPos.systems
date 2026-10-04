import { afterAll, beforeAll, expect, it } from 'vitest';
import { SYSTEM_ROLES, IdempotencyKeyReusedError } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  decisionActor,
  leaveDecisionFixture,
  type LeaveDecisionFixture,
} from './leave-decision.fixture.ts';
import { leaveActor, leaveIds, leaveTerms } from './leave.fixture.ts';
import { createLeaveTransactions } from '../persistence/drizzle-leave-transactions.ts';
import { DecideLeaveUseCase } from '../use-cases/decide-leave/decide-leave.usecase.ts';
import { RevokeLeaveUseCase } from '../use-cases/revoke-leave/revoke-leave.usecase.ts';
let f: LeaveDecisionFixture;
beforeAll(async () => {
  f = await leaveDecisionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const approve = {
  decision: 'APPROVED' as const,
  expected_revision: 1,
  reason: 'Synthetic approval',
};

it('approves/rejects/revokes once, preserving decision and omitting sensitive audit/event text', async () => {
  const row = await f.request.execute(leaveActor(f), leaveTerms('2027-05-01'));
  const actor = decisionActor(f, row.id);
  const decided = await f.decide.execute(actor, approve);
  expect(decided).toMatchObject({
    status: 'APPROVED',
    decided_by: f.approverId,
    decided_at: f.clock.now().toISOString(),
    revision: 2,
  });
  expect(await f.decide.execute(actor, approve)).toEqual(decided);
  const revoked = await f.revoke.execute(decisionActor(f, row.id), {
    expected_revision: 2,
    reason: '  Synthetic revocation  ',
  });
  expect(revoked).toMatchObject({
    status: 'CANCELLED',
    decided_by: f.approverId,
    revoked_by: f.approverId,
    decision_reason: 'Synthetic approval',
    revocation_reason: 'Synthetic revocation',
    revision: 3,
  });
  const rejected = await f.request.execute(leaveActor(f), leaveTerms('2027-05-02'));
  expect(
    await f.decide.execute(decisionActor(f, rejected.id), {
      decision: 'REJECTED',
      expected_revision: 1,
      reason: '  Synthetic refusal  ',
    }),
  ).toMatchObject({
    rejection_reason: 'Synthetic refusal',
    decision_reason: 'Synthetic refusal',
    status: 'REJECTED',
  });
  const audits = await f.h
    .owner`SELECT action,before,after FROM audit_log WHERE company_id=${f.company} AND entity='leave_request' AND entity_id=${row.id} ORDER BY id`;
  expect(audits.map((r) => r['action'])).toEqual([
    'leave.requested',
    'leave.approved',
    'leave.revoked',
  ]);
  const events = await f.h
    .owner`SELECT event_type,payload FROM outbox WHERE company_id=${f.company} AND aggregate_id=${row.id} ORDER BY id`;
  expect(events.map((r) => r['event_type'])).toEqual([
    'LeaveRequested',
    'LeaveApproved',
    'LeaveRevoked',
  ]);
  for (const key of ['note', 'decision_reason', 'rejection_reason', 'revocation_reason']) {
    for (const audit of audits) expect(audit['after']).not.toHaveProperty(key);
    for (const event of events) expect(event['payload']).not.toHaveProperty(key);
  }
});
it('fingerprints the leave identity and refuses reused keys with another leave or body', async () => {
  const a = await f.request.execute(leaveActor(f), leaveTerms('2027-05-03'));
  const b = await f.request.execute(leaveActor(f), leaveTerms('2027-05-04'));
  const actor = decisionActor(f, a.id);
  await f.decide.execute(actor, approve);
  await expect(f.decide.execute({ ...actor, leaveId: b.id }, approve)).rejects.toBeInstanceOf(
    IdempotencyKeyReusedError,
  );
  await expect(
    f.decide.execute(
      { ...actor, fingerprint: 'different' },
      { ...approve, reason: 'Other reason' },
    ),
  ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
});
it('cannot decide own leave through a second membership or on-behalf requester', async () => {
  const row = await f.request.execute(leaveActor(f), leaveTerms('2027-05-05'));
  const role = SYSTEM_ROLES.find((r) => r.code === 'general_manager');
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES(${f.company},${leaveIds.newId()},${f.userId},${role?.id as string},'global','COMPANY',${f.company},'2026-01-01')`;
  await expect(
    f.decide.execute({ ...decisionActor(f, row.id), userId: f.userId }, approve),
  ).rejects.toThrow('LEAVE_SELF_DECISION_FORBIDDEN');
  const behalf = await f.request.execute(
    { ...leaveActor(f), userId: f.approverId },
    leaveTerms('2027-05-06'),
  );
  await expect(
    f.decide.execute({ ...decisionActor(f, behalf.id), userId: f.userId }, approve),
  ).rejects.toThrow('LEAVE_SELF_DECISION_FORBIDDEN');
});
it.each(['owner', 'general_manager', 'business_manager', 'branch_manager'])(
  '%s defaults decide within scope only',
  async (code) => {
    const role = SYSTEM_ROLES.find((r) => r.code === code);
    const scope =
      code === 'branch_manager' ? 'BRANCH' : code === 'business_manager' ? 'BUSINESS' : 'COMPANY';
    const scopeId = scope === 'BRANCH' ? f.branch : scope === 'BUSINESS' ? f.business : f.company;
    await f.h
      .owner`UPDATE memberships SET role_id=${role?.id as string},scope_type=${scope},scope_id=${scopeId} WHERE id=${f.approverMember}`;
    const date = `2027-06-0${['owner', 'general_manager', 'business_manager', 'branch_manager'].indexOf(code) + 1}`;
    const row = await f.request.execute(leaveActor(f), leaveTerms(date));
    expect((await f.decide.execute(decisionActor(f, row.id), approve)).status).toBe('APPROVED');
    if (code === 'branch_manager') {
      const hidden = await f.request.execute(
        { ...leaveActor(f), branchId: f.secondBranch },
        leaveTerms('2027-06-10'),
      );
      await expect(f.decide.execute(decisionActor(f, hidden.id), approve)).rejects.toThrow(
        'NOT_FOUND',
      );
    }
  },
);
it('supports a delegated human ALLOW while a covering DENY still wins', async () => {
  const role = SYSTEM_ROLES.find((r) => r.code === 'staff');
  await f.h
    .owner`UPDATE memberships SET role_id=${role?.id as string},scope_type='BRANCH',scope_id=${f.branch} WHERE id=${f.approverMember}`;
  const row = await f.request.execute(leaveActor(f), leaveTerms('2027-06-11'));
  await expect(f.decide.execute(decisionActor(f, row.id), approve)).rejects.toThrow('NOT_FOUND');
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${leaveIds.newId()},${f.approverMember},'decide:leave:branch','ALLOW','BRANCH',${f.branch},'Synthetic delegation',${f.userId})`;
  expect((await f.decide.execute(decisionActor(f, row.id), approve)).status).toBe('APPROVED');
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${leaveIds.newId()},${f.approverMember},'decide:leave:branch','DENY','BRANCH',${f.branch},'Synthetic refusal',${f.userId})`;
  const blocked = await f.request.execute(leaveActor(f), leaveTerms('2027-06-12'));
  await expect(f.decide.execute(decisionActor(f, blocked.id), approve)).rejects.toThrow(
    'NOT_FOUND',
  );
  await f.h.owner`DELETE FROM permission_overrides WHERE membership_id=${f.approverMember}`;
  const manager = SYSTEM_ROLES.find((r) => r.code === 'business_manager');
  await f.h
    .owner`UPDATE memberships SET role_id=${manager?.id as string},scope_type='BUSINESS',scope_id=${f.business} WHERE id=${f.approverMember}`;
});
it('serializes cancel vs decide and competing decisions; loser gets a named pending conflict', async () => {
  for (const [date, competingCancel] of [
    ['2027-07-01', true],
    ['2027-07-02', false],
  ] as const) {
    const row = await f.request.execute(leaveActor(f), leaveTerms(date));
    const results = await Promise.allSettled([
      f.decide.execute(decisionActor(f, row.id), approve),
      competingCancel
        ? f.cancel.execute({ ...leaveActor(f), leaveId: row.id }, { expected_revision: 1 })
        : f.decide.execute(decisionActor(f, row.id), {
            decision: 'REJECTED',
            expected_revision: 1,
            reason: 'Synthetic refusal',
          }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected');
    expect(failure?.status === 'rejected' ? failure.reason.code : null).toBe('LEAVE_NOT_PENDING');
    expect(
      await f.h
        .owner`SELECT id FROM audit_log WHERE entity='leave_request' AND entity_id=${row.id}`,
    ).toHaveLength(2);
  }
});
it('uses one injected instant for decision authority, feature expiry and the revocation deadline', async () => {
  const row = await f.request.execute(leaveActor(f), leaveTerms('2027-08-01'));
  await f.decide.execute(decisionActor(f, row.id), approve);
  let calls = 0;
  const clock = {
    now: () => {
      calls++;
      return new Date(Date.parse(row.starts_at) - 1);
    },
  };
  const revoke = new RevokeLeaveUseCase(createLeaveTransactions(f.db, leaveIds), clock);
  expect(
    (
      await revoke.execute(decisionActor(f, row.id), {
        expected_revision: 2,
        reason: 'Synthetic correction',
      })
    ).revoked_at,
  ).toBe(new Date(Date.parse(row.starts_at) - 1).toISOString());
  expect(calls).toBe(1);
  const expiry = '2027-09-01T00:00:00Z';
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by,expires_at) VALUES(${f.company},'staff',false,'Synthetic expiry',${f.userId},${expiry})`;
  const late = await f.request.execute(leaveActor(f), leaveTerms('2027-09-02')).catch(() => null);
  expect(late).toBeNull();
  await f.h
    .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  const future = await f.request.execute(leaveActor(f), leaveTerms('2027-09-02'));
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by,expires_at) VALUES(${f.company},'staff',false,'Synthetic expiry',${f.userId},${expiry})`;
  const afterExpiry = new DecideLeaveUseCase(createLeaveTransactions(f.db, leaveIds), {
    now: () => new Date(expiry),
  });
  expect((await afterExpiry.execute(decisionActor(f, future.id), approve)).status).toBe('APPROVED');
});
it('rolls back the decision, audit, event and idempotency response if persistence fails', async () => {
  await f.h
    .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  const row = await f.request.execute(leaveActor(f), leaveTerms('2027-10-01'));
  const ids = { newId: () => f.company };
  await f.h
    .owner`INSERT INTO audit_log(company_id,id,actor_user_id,entity,entity_id,action) VALUES(${f.company},${f.company},${f.userId},'synthetic',${row.id},'synthetic')`;
  const actor = decisionActor(f, row.id);
  const failing = new DecideLeaveUseCase(createLeaveTransactions(f.db, ids), f.clock);
  await expect(failing.execute(actor, approve)).rejects.toThrow();
  expect(await f.h.owner`SELECT status,revision FROM leave_requests WHERE id=${row.id}`).toEqual([
    { status: 'PENDING', revision: 1 },
  ]);
  expect(await f.h.owner`SELECT id FROM outbox WHERE aggregate_id=${row.id}`).toHaveLength(1);
  expect(
    await f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`SELECT key FROM idempotency_keys WHERE key=${actor.key}`),
    ),
  ).toHaveLength(0);
});
