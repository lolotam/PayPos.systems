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
  const plan = JSON.stringify(await explain(scope.company, statement, true));
  expect(plan).toContain('"Conflict Resolution":"NOTHING"');
  expect(plan).toContain('discount_self_approval_notices_source_event_key');
  expect(await f.notices(prepared.event.id)).toHaveLength(1);
}, 120_000);

const INDEXES = /dp_pk|dp_business_id_key|dp_consumed_line_key|dp_consumed_edit_key/;

it('the default planner reads discount_proposals through a company-scoped index', async () => {
  const { scope, statement } = await proofStatement();
  const plan = JSON.stringify(await explain(scope.company, statement, false));
  expect(plan).toMatch(INDEXES);
  expect(plan).toMatch(/Index Cond[^}]*company_id = [^}]*\(id = /);
  expect(plan).not.toContain('Seq Scan');
}, 240_000);

it('the proposal proof stays index-eligible when sequential scans are disabled', async () => {
  const { scope, statement } = await proofStatement();
  const plan = JSON.stringify(await explain(scope.company, statement, true));
  expect(plan).toMatch(INDEXES);
  expect(plan).not.toContain('Seq Scan');
}, 240_000);

// الخطة الافتراضية تقلب من مسح تسلسلي إلى بحث بالفهرس بين 1200 و1400 صف للشركة، فنزرع 2000 (100 دفعة) ليكون الحجم واقعياً.
let proof: ReturnType<typeof seedProof> | undefined;
function proofStatement() {
  proof ??= seedProof();
  return proof;
}

async function seedProof() {
  const scope = await f.otherScope();
  const prepared = await f.selfApproval({ scope, proposals: Array(20).fill({}) });
  for (let batch = 1; batch < 100; batch += 1) {
    await f.selfApproval({ scope, proposals: Array(20).fill({}) });
  }
  await f.owner`ANALYZE discount_proposals`;
  return { scope, statement: discountSelfApprovalMatchesStatement(f.noticeEvent(prepared)) };
}

function explain(companyId: string, statement: SQL, noSeqScan: boolean) {
  return f.db.withTenant(companyId, async (tx) => {
    if (noSeqScan) await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
  });
}
