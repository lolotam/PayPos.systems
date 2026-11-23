import { afterEach, beforeEach, expect, it } from 'vitest';

import { createCommissionPeriodRepairTransactions } from '../persistence/drizzle-commission-period-repair-transactions.ts';
import { repairCommissionPeriod } from '../use-cases/repair-commission-period/repair-commission-period.usecase.ts';
import {
  COMMISSION_NOW,
  ids,
  memberWithoutPlanPermission,
} from './commission-plan-versions.fixture.ts';
import {
  flatPlan,
  NO_PLAN_REPAIR,
  repairFixture,
  repairWrites,
  seedBlockedSeptember,
  type RepairFixture,
} from './commission-period-repair.fixture.ts';
import {
  expectStoredResponseUnchanged,
  grantPlanPermission,
  REPLAY_TEST_TIMEOUT_MS,
  replayAfterRevocation,
  revokePlanPermission,
  trackBackend,
} from './replay-access-barrier.ts';

let r: RepairFixture;
beforeEach(async () => {
  r = await repairFixture();
});
afterEach(async () => {
  await r.db.close();
  await r.h.close();
});

it.each([
  ['access revoked while it waits', true, /^FORBIDDEN$/],
  ['access intact', false, /^IdempotencyKeyBusyError/],
])(
  'a claim wait that times out with %s answers the matching outcome and leaves the stored response unchanged',
  async (_name, revoke, expected) => {
    await seedBlockedSeptember(r, {
      plan: flatPlan(1000),
      planFrom: '2026-09-15',
      lines: [{ id: ids.newId(), date: '2026-09-10', net: '200.000' }],
      frozen: [],
    });
    const member = await memberWithoutPlanPermission(r);
    const grant = ids.newId();
    await grantPlanPermission(r.h.owner, {
      company: r.company,
      business: r.business,
      userId: r.userId,
      membershipId: member.membershipId,
      id: grant,
    });
    const firstDb = trackBackend(r.db);
    const secondDb = trackBackend(r.db);
    const clock = { now: () => COMMISSION_NOW };
    const open = (database: typeof firstDb) =>
      createCommissionPeriodRepairTransactions(database.database, ids, r.readers, clock);
    const command = {
      companyId: r.company,
      userId: member.userId,
      businessId: r.business,
      employeeId: r.employee,
      key: 'repair-busy-claim',
      fingerprint: 'e'.repeat(64),
      input: { period: '2026-09', plan: NO_PLAN_REPAIR },
    };
    let firstResponse: unknown;

    const { blocked, secondOutcome, diagnostic } = await replayAfterRevocation({
      owner: r.h.owner,
      pids: () => ({ first: firstDb.pid(), second: secondDb.pid() }),
      startFirst: (gate, reachedGate) =>
        open(firstDb).run(command, async (scope) => {
          const saved = await repairCommissionPeriod(scope, command, ids, clock);
          reachedGate();
          await gate;
          firstResponse = saved;
          return saved;
        }),
      startSecond: () =>
        open(secondDb).run(command, (scope) => repairCommissionPeriod(scope, command, ids, clock)),
      ...(revoke ? { revoke: () => revokePlanPermission(r.h.owner, r.company, grant) } : {}),
      holdUntilSecondSettles: true,
    });

    expect(
      blocked,
      `the second request was never observed blocked on the claim (${diagnostic})`,
    ).toBe(true);
    expect(secondOutcome).toMatch(expected);
    await expectStoredResponseUnchanged(r.h.owner, {
      company: r.company,
      operation: 'repair-commission-period',
      key: command.key,
      response: firstResponse,
    });
    expect(await repairWrites(r)).toEqual([1, 1, 1, 1]);
  },
  REPLAY_TEST_TIMEOUT_MS,
);
