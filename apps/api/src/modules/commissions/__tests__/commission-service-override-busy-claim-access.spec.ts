import { afterEach, beforeEach, expect, it } from 'vitest';

import { createCommissionServiceOverrideTransactions } from '../persistence/drizzle-commission-service-override-transactions.ts';
import { writeCommissionServiceOverride } from '../use-cases/create-commission-service-override/create-commission-service-override.usecase.ts';
import {
  closeCommissionFixture,
  ids,
  memberWithoutPlanPermission,
} from './commission-plan-versions.fixture.ts';
import {
  commissionServiceOverridesFixture,
  overrideAndAuditCounts,
  overrideCommand,
  OVERRIDE_NOW,
  overrideInput,
  type CommissionServiceOverrideFixture,
} from './commission-service-overrides.fixture.ts';
import {
  expectStoredResponseUnchanged,
  grantPlanPermission,
  REPLAY_TEST_TIMEOUT_MS,
  replayAfterRevocation,
  revokePlanPermission,
  trackBackend,
} from './replay-access-barrier.ts';

let f: CommissionServiceOverrideFixture;
let member: Awaited<ReturnType<typeof memberWithoutPlanPermission>>;
beforeEach(async () => {
  f = await commissionServiceOverridesFixture();
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
    const open = (tracked: typeof firstDb) =>
      createCommissionServiceOverrideTransactions(tracked.database, ids, f.readers);
    const clock = { now: () => OVERRIDE_NOW };
    const command = overrideCommand(
      f,
      overrideInput(f),
      'override-busy-claim',
      'e'.repeat(64),
      f.employee,
      member.userId,
    );
    let firstResponse: unknown;
    const before = await overrideAndAuditCounts(f);

    const { blocked, secondOutcome, diagnostic } = await replayAfterRevocation({
      owner: f.h.owner,
      pids: () => ({ first: firstDb.pid(), second: secondDb.pid() }),
      startFirst: (gate, reachedGate) =>
        open(firstDb).run(command, async (scope) => {
          const saved = await writeCommissionServiceOverride(scope, command, ids, clock);
          reachedGate();
          await gate;
          firstResponse = saved;
          return saved;
        }),
      startSecond: () =>
        open(secondDb).run(command, (scope) =>
          writeCommissionServiceOverride(scope, command, ids, clock),
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
      operation: 'create-commission-service-override',
      key: command.key,
      response: firstResponse,
    });
    expect(await overrideAndAuditCounts(f)).toEqual(before.map((count) => count + 1));
  },
  REPLAY_TEST_TIMEOUT_MS,
);
