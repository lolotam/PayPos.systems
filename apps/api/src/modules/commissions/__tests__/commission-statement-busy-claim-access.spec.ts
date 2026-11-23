import { createDatabase } from '@pospay/db';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { createCommissionStatementGenerateTransactions } from '../persistence/drizzle-commission-statement-generate-transactions.ts';
import { CanonicalSha256FingerprintHasher } from '../persistence/canonical-sha256-fingerprint-hasher.ts';
import { generateStatement as generateStatementSteps } from '../use-cases/generate-statement/generate-statement.usecase.ts';
import {
  ids,
  memberWithGrants,
  READ,
  REVIEW,
  statementFixture,
  statementReaders,
  type StatementFixture,
} from './commission-statement.fixture.ts';
import {
  REPLAY_TEST_TIMEOUT_MS,
  replayAfterRevocation,
  revokePlanPermission,
  trackBackend,
} from './replay-access-barrier.ts';

let f: StatementFixture;
beforeEach(async () => {
  f = await statementFixture();
});
afterEach(async () => {
  await f.h.close();
});

const clock = { now: () => new Date('2026-12-02T09:00:00Z') };
const hasher = new CanonicalSha256FingerprintHasher();

it.each([
  ['review withdrawn while it waits', true, /^FORBIDDEN$/],
  ['access intact', false, /^IdempotencyKeyBusyError/],
])(
  'a claim wait that times out with %s answers the matching outcome and leaves the stored response unchanged',
  async (_name, revoke, expected) => {
    const member = await memberWithGrants(f, 'busy-claim', [{ permission: READ, scope: 'BUSINESS' }]);
    const [membership] = member.membershipIds;
    if (membership === undefined) throw new Error('the member has no membership');
    const grant = ids.newId();
    await f.h.owner`INSERT INTO permission_overrides(
      company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES (${f.company},${grant}::uuid,${membership}::uuid,${REVIEW},'ALLOW',
        'BUSINESS',${f.business}::uuid,'busy claim proof',${member.userId})`;
    const db = createDatabase({ url: f.h.urls.app, ids });
    const firstDb = trackBackend(db);
    const secondDb = trackBackend(db);
    const open = (tracked: typeof firstDb) =>
      createCommissionStatementGenerateTransactions(tracked.database, ids, statementReaders());
    const command = {
      companyId: f.company,
      userId: member.userId,
      businessId: f.business,
      period: '2026-11',
      key: 'statement-busy-claim',
      fingerprint: 'e'.repeat(64),
    };
    let firstResponse: unknown;

    const { blocked, secondOutcome, diagnostic } = await replayAfterRevocation({
      owner: f.h.owner,
      pids: () => ({ first: firstDb.pid(), second: secondDb.pid() }),
      startFirst: (gate, reachedGate) =>
        open(firstDb).run(command, async (scope) => {
          const saved = await generateStatementSteps(scope, command, hasher, clock);
          reachedGate();
          await gate;
          firstResponse = saved;
          return saved;
        }),
      startSecond: () =>
        open(secondDb).run(command, (scope) =>
          generateStatementSteps(scope, command, hasher, clock),
        ),
      ...(revoke ? { revoke: () => revokePlanPermission(f.h.owner, f.company, grant) } : {}),
      holdUntilSecondSettles: true,
    });
    await db.close();

    expect(
      blocked,
      `the second request was never observed blocked on the claim (${diagnostic})`,
    ).toBe(true);
    expect(secondOutcome).toMatch(expected);
    const claims = await f.h.owner`SELECT response_status, response_body FROM idempotency_keys
      WHERE company_id=${f.company} AND operation='generate-commission-statement'
        AND key=${command.key}`;
    expect(claims).toHaveLength(1);
    expect(claims[0]?.['response_status']).toBe(200);
    expect(claims[0]?.['response_body']).toEqual(JSON.parse(JSON.stringify(firstResponse)));
    const audits = await f.h.owner`SELECT count(*)::int AS count FROM audit_log
      WHERE action='commission_statement.generated'`;
    expect(audits[0]?.['count']).toBe(1);
  },
  REPLAY_TEST_TIMEOUT_MS,
);
