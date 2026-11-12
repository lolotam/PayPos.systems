import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  discountSelfApprovalClaimStatement,
  discountSelfApprovalMatchesStatement,
} from '../persistence/discount-self-approval-notice.repository.ts';
import {
  discountSelfApprovalFixture,
  type DiscountSelfApprovalFixture,
} from './discount-self-approval-notice.fixture.ts';

let f: DiscountSelfApprovalFixture;
beforeAll(async () => {
  f = await discountSelfApprovalFixture();
});
afterAll(async () => {
  await f?.close();
});

it('the claim plan uses the source-event conflict arbiter and does nothing on conflict', async () => {
  const scope = await f.otherScope();
  const prepared = await f.selfApproval({ scope });
  await f.owner`ANALYZE discount_self_approval_notices`;
  const statement = discountSelfApprovalClaimStatement(f.noticeEvent(prepared), {
    id: f.ids.newId(),
    sourceEventId: prepared.event.id,
    decidedAt: f.at,
    recipientCount: 1,
  });
  const plan = JSON.stringify(await explain(scope.company, statement));
  expect(plan).toContain('"Conflict Resolution":"NOTHING"');
  expect(plan).toContain('discount_self_approval_notices_source_event_key');
  expect(await f.notices(prepared.event.id)).toHaveLength(1);
}, 120_000);

it('the proposal proof reads discount_proposals through a tenant-scoped index with no sequential scan', async () => {
  const { scope, statement } = await proofStatement();
  const plan = JSON.stringify(await explain(scope.company, statement));
  expect(plan).toContain('"Index Name"');
  expect(plan).toMatch(/"Index Cond":"[^"]*\bcompany_id\b/);
  expect(plan).not.toContain('Seq Scan');
}, 120_000);

async function proofStatement() {
  const scope = await f.otherScope();
  const prepared = await f.selfApproval({ scope, proposals: Array(20).fill({}) });
  for (let batch = 1; batch < 5; batch += 1) {
    await f.selfApproval({ scope, proposals: Array(20).fill({}) });
  }
  await f.owner`ANALYZE discount_proposals`;
  return { scope, statement: discountSelfApprovalMatchesStatement(f.noticeEvent(prepared)) };
}

function explain(companyId: string, statement: SQL) {
  return f.db.withTenant(companyId, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
  });
}
