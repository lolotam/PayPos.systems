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
  grantPlanPermission,
  expectStoredResponseUnchanged,
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

/** كاتب تجاوز بغلاف قاعدة بيسجّل اتصال معاملته، عشان الانتظار يتربط بالطلب بالاسم. */
const trackedWriter = () => {
  const tracked = trackBackend(f.db);
  return {
    pid: tracked.pid,
    transactions: createCommissionServiceOverrideTransactions(tracked.database, ids, f.readers),
  };
};

it.each([
  ['the same request (a stored replay)', 'e'.repeat(64)],
  ['a different request on the same key (a reused key)', 'f'.repeat(64)],
])(
  'a revocation committed while %s waits on the in-flight key answers the uniform 403 and no stored body',
  async (_name, secondFingerprint) => {
    const grant = ids.newId();
    await grantPlanPermission(f.h.owner, {
      company: f.company,
      business: f.business,
      userId: f.userId,
      membershipId: member.membershipId,
      id: grant,
    });
    const firstRequest = trackedWriter();
    const secondRequest = trackedWriter();
    const clock = { now: () => OVERRIDE_NOW };
    const command = overrideCommand(
      f,
      overrideInput(f),
      `override-replay-${secondFingerprint[0]}`,
      'e'.repeat(64),
      f.employee,
      member.userId,
    );
    const duplicate = { ...command, fingerprint: secondFingerprint };
    let firstResponse: unknown;
    const before = await overrideAndAuditCounts(f);

    const { blocked, secondOutcome, diagnostic } = await replayAfterRevocation({
      owner: f.h.owner,
      pids: () => ({ first: firstRequest.pid(), second: secondRequest.pid() }),
      startFirst: (gate, reachedGate) =>
        firstRequest.transactions.run(command, async (scope) => {
          const saved = await writeCommissionServiceOverride(scope, command, ids, clock);
          reachedGate();
          await gate;
          firstResponse = saved;
          return saved;
        }),
      startSecond: () =>
        secondRequest.transactions.run(duplicate, (scope) =>
          writeCommissionServiceOverride(scope, duplicate, ids, clock),
        ),
      revoke: () => revokePlanPermission(f.h.owner, f.company, grant),
    });

    expect(
      blocked,
      `the second request was never observed blocked by the first on the claim (${diagnostic})`,
    ).toBe(true);
    expect(secondOutcome).toBe('FORBIDDEN');
    await expectStoredResponseUnchanged(f.h.owner, {
      company: f.company,
      operation: 'create-commission-service-override',
      key: command.key,
      response: firstResponse,
    });
    // الطلب الأول وحده كتب تجاوزاً وتدقيقاً واحداً؛ التاني ما كتبش ولا سطر.
    expect(await overrideAndAuditCounts(f)).toEqual(before.map((count) => count + 1));
  },
  REPLAY_TEST_TIMEOUT_MS,
);
