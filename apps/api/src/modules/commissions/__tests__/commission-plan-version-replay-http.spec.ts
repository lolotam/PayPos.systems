import { afterEach, beforeEach, expect, it } from 'vitest';

import { createCommissionPlanVersionTransactions } from '../persistence/drizzle-commission-plan-version-transactions.ts';
import { writeCommissionPlanVersion } from '../use-cases/create-commission-plan-version/create-commission-plan-version.usecase.ts';
import {
  closeCommissionFixture,
  type DatabaseWrap,
  COMMISSION_NOW,
  commissionPlanInput,
  commissionPlanVersionsFixture,
  ids,
  memberWithoutPlanPermission,
  versionAndAuditCounts,
  type CommissionPlanFixture,
} from './commission-plan-versions.fixture.ts';
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

let f: CommissionPlanFixture;
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
  f = await commissionPlanVersionsFixture(undefined, wrapApp);
});
afterEach(async () => {
  await closeCommissionFixture(f);
});

it(
  'a reused key answered after the permission was withdrawn is the plain 403 body, and the second request adds nothing',
  async () => {
    const member = await memberWithoutPlanPermission(f);
    const plain = await f.post(
      commissionPlanInput(),
      'replay-http-plain',
      f.employee,
      member.cookie,
    );
    expect(plain.status).toBe(403);
    await grantRolePermission(f.h.owner, f.company, member.membershipId);
    const appTracker = trackedApp();
    const firstDb = trackBackend(f.db);
    const firstRequest = createCommissionPlanVersionTransactions(firstDb.database, ids, f.readers);
    const command = {
      companyId: f.company,
      userId: member.userId,
      businessId: f.business,
      employeeId: f.employee,
      input: commissionPlanInput(),
      key: 'replay-http-key',
      fingerprint: 'e'.repeat(64),
    };
    let firstResponse: unknown;
    const before = await versionAndAuditCounts(f);

    const { blocked, secondOutcome, secondValue, diagnostic } = await replayAfterRevocation({
      owner: f.h.owner,
      pids: () => ({ first: firstDb.pid(), second: appTracker.pid() }),
      startFirst: (gate, reachedGate) =>
        firstRequest.run(command, async (scope) => {
          const saved = await writeCommissionPlanVersion(scope, command, ids, {
            now: () => COMMISSION_NOW,
          });
          reachedGate();
          await gate;
          firstResponse = saved;
          return saved;
        }),
      startSecond: () => {
        appTracker.reset();
        return f.post(commissionPlanInput(), 'replay-http-key', f.employee, member.cookie);
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
      operation: 'create-commission-plan-version',
      key: 'replay-http-key',
      response: firstResponse,
    });
    expect(await versionAndAuditCounts(f)).toEqual(before.map((count) => count + 1));
  },
  REPLAY_TEST_TIMEOUT_MS,
);
