import { SYSTEM_ROLES } from '@pospay/db';
import { leaveActor, leaveFixture, leaveIds } from './leave.fixture.ts';
import { createLeaveTransactions } from '../persistence/drizzle-leave-transactions.ts';
import { DecideLeaveUseCase } from '../use-cases/decide-leave/decide-leave.usecase.ts';
import { RevokeLeaveUseCase } from '../use-cases/revoke-leave/revoke-leave.usecase.ts';

export async function leaveDecisionFixture() {
  const f = await leaveFixture();
  const approverCookie = await f.h.signedInOperator('synthetic-leave-approver@example.test');
  const [user] = await f.h
    .owner`SELECT id FROM "user" WHERE email='synthetic-leave-approver@example.test'`;
  const approverId = user?.['id'] as string;
  const approverMember = leaveIds.newId();
  const role = SYSTEM_ROLES.find((r) => r.code === 'business_manager');
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES(${f.company},${approverMember},${approverId},${role?.id as string},'global','BUSINESS',${f.business},'2026-01-01')`;
  const tx = createLeaveTransactions(f.db, leaveIds);
  return {
    ...f,
    approverId,
    approverCookie,
    approverMember,
    decide: new DecideLeaveUseCase(tx, f.clock),
    revoke: new RevokeLeaveUseCase(tx, f.clock),
  };
}
export type LeaveDecisionFixture = Awaited<ReturnType<typeof leaveDecisionFixture>>;
export const decisionActor = (
  f: LeaveDecisionFixture,
  leaveId: string,
  key = leaveIds.newId(),
) => ({ ...leaveActor(f, key), userId: f.approverId, leaveId });
