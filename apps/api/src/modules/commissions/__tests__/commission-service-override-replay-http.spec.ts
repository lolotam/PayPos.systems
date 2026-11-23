import { afterEach, beforeEach, expect, it } from 'vitest';

import { createCommissionServiceOverrideTransactions } from '../persistence/drizzle-commission-service-override-transactions.ts';
import { writeCommissionServiceOverride } from '../use-cases/create-commission-service-override/create-commission-service-override.usecase.ts';
import {
  closeCommissionFixture,
  type DatabaseWrap,
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
  expectPlainRefusal,
  expectStoredResponseUnchanged,
  grantRolePermission,
  REPLAY_TEST_TIMEOUT_MS,
  replayAfterRevocation,
  type TrackedDatabase,
  revokeRolePermission,
  trackBackend,
} from './replay-access-barrier.ts';

let f: CommissionServiceOverrideFixture;
const app: { tracker?: TrackedDatabase } = {};
const wrapApp: DatabaseWrap = (database) => {
  app.tracker = trackBackend(database);
  return app.tracker.database;
};
const trackedApp = (): TrackedDatabase => {
  if (app.tracker === undefined) throw new Error('the app database was not tracked');
  return app.tracker;
};
beforeEach(async () => {
  f = await commissionServiceOverridesFixture(wrapApp);
});
afterEach(async () => {
  await closeCommissionFixture(f);
});

it(
  'a reused key answered after the permission was withdrawn is the plain 403 body, and the second request adds nothing',
  async () => {
    const member = await memberWithoutPlanPermission(f);
    const plain = await f.postOverride(
      overrideInput(f),
      'replay-http-plain',
      f.employee,
      member.cookie,
    );
    expect(plain.status).toBe(403);
    await grantRolePermission(f.h.owner, f.company, member.membershipId);
    const appTracker = trackedApp();
    const firstDb = trackBackend(f.db);
    const firstRequest = createCommissionServiceOverrideTransactions(
      firstDb.database,
      ids,
      f.readers,
    );
    const command = overrideCommand(
      f,
      overrideInput(f),
      'replay-http-key',
      'e'.repeat(64),
      f.employee,
      member.userId,
    );
    let firstResponse: unknown;
    const before = await overrideAndAuditCounts(f);

    const { blocked, secondOutcome, secondValue, diagnostic } = await replayAfterRevocation({
      owner: f.h.owner,
      pids: () => ({ first: firstDb.pid(), second: appTracker.pid() }),
      startFirst: (gate, reachedGate) =>
        firstRequest.run(command, async (scope) => {
          const saved = await writeCommissionServiceOverride(scope, command, ids, {
            now: () => OVERRIDE_NOW,
          });
          reachedGate();
          await gate;
          firstResponse = saved;
          return saved;
        }),
      startSecond: () => {
        appTracker.reset();
        return f.postOverride(overrideInput(f), 'replay-http-key', f.employee, member.cookie);
      },
      revoke: () => revokeRolePermission(f.h.owner, f.company, member.membershipId),
    });

    expect(
      blocked,
      `the HTTP request was never observed blocked by the first on the claim (${diagnostic})`,
    ).toBe(true);
    expect(secondOutcome).toBe('answered');
    expectPlainRefusal(secondValue, plain);
    await expectStoredResponseUnchanged(f.h.owner, {
      company: f.company,
      operation: 'create-commission-service-override',
      key: 'replay-http-key',
      response: firstResponse,
    });
    expect(await overrideAndAuditCounts(f)).toEqual(before.map((count) => count + 1));
  },
  REPLAY_TEST_TIMEOUT_MS,
);
