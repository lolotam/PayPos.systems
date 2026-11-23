import { afterEach, beforeEach, expect, it } from 'vitest';

import { createCommissionPlanVersionTransactions } from '../persistence/drizzle-commission-plan-version-transactions.ts';
import { writeCommissionPlanVersion } from '../use-cases/create-commission-plan-version/create-commission-plan-version.usecase.ts';
import {
  closeCommissionFixture,
  COMMISSION_NOW,
  commissionPlanInput,
  commissionPlanVersionsFixture,
  ids,
  memberWithoutPlanPermission,
  versionAndAuditCounts,
  type CommissionPlanFixture,
} from './commission-plan-versions.fixture.ts';
import {
  expectStoredResponseUnchanged,
  grantPlanPermission,
  REPLAY_TEST_TIMEOUT_MS,
  replayAfterRevocation,
  revokePlanPermission,
  trackBackend,
} from './replay-access-barrier.ts';

let f: CommissionPlanFixture;
let member: Awaited<ReturnType<typeof memberWithoutPlanPermission>>;
beforeEach(async () => {
  f = await commissionPlanVersionsFixture();
  member = await memberWithoutPlanPermission(f);
});
afterEach(async () => {
  await closeCommissionFixture(f);
});

it.each([
  ['access revoked while it waits', true, /^FORBIDDEN$/],
  ['access intact', false, /^IdempotencyKeyBusyError/],
])(
  'a claim wait that times out with %s answers the matching outcome and leaves the stored response unchanged',
  async (_name, revoke, expected) => {
    const grant = ids.newId();
    await grantPlanPermission(f.h.owner, {
      company: f.company,
      business: f.business,
      userId: f.userId,
      membershipId: member.membershipId,
      id: grant,
    });
    const firstDb = trackBackend(f.db);
    const secondDb = trackBackend(f.db);
    const firstRequest = createCommissionPlanVersionTransactions(firstDb.database, ids, f.readers);
    const secondRequest = createCommissionPlanVersionTransactions(
      secondDb.database,
      ids,
      f.readers,
    );
    const clock = { now: () => COMMISSION_NOW };
    const command = {
      companyId: f.company,
      userId: member.userId,
      businessId: f.business,
      employeeId: f.employee,
      input: commissionPlanInput(),
      key: 'plan-busy-claim',
      fingerprint: 'e'.repeat(64),
    };
    let firstResponse: unknown;
    const before = await versionAndAuditCounts(f);

    const { blocked, secondOutcome, diagnostic } = await replayAfterRevocation({
      owner: f.h.owner,
      pids: () => ({ first: firstDb.pid(), second: secondDb.pid() }),
      startFirst: (gate, reachedGate) =>
        firstRequest.run(command, async (scope) => {
          const saved = await writeCommissionPlanVersion(scope, command, ids, clock);
          reachedGate();
          await gate;
          firstResponse = saved;
          return saved;
        }),
      startSecond: () =>
        secondRequest.run(command, (scope) =>
          writeCommissionPlanVersion(scope, command, ids, clock),
        ),
      ...(revoke ? { revoke: () => revokePlanPermission(f.h.owner, f.company, grant) } : {}),
      holdUntilSecondSettles: true,
    });

    expect(
      blocked,
      `the second request was never observed blocked on the claim (${diagnostic})`,
    ).toBe(true);
    expect(secondOutcome).toMatch(expected);
    await expectStoredResponseUnchanged(f.h.owner, {
      company: f.company,
      operation: 'create-commission-plan-version',
      key: command.key,
      response: firstResponse,
    });
    expect(await versionAndAuditCounts(f)).toEqual(before.map((count) => count + 1));
  },
  REPLAY_TEST_TIMEOUT_MS,
);
