import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import {
  discountApprovalClaimStatement,
  discountApprovalMatchesStatement,
} from '../persistence/discount-approval-notice.repository.ts';
import {
  discountApprovalFixture,
  type DiscountApprovalFixture,
} from './discount-approval-notice.fixture.ts';

let f: DiscountApprovalFixture;
beforeAll(async () => {
  f = await discountApprovalFixture();
});
afterAll(async () => {
  await f?.close();
});

it('the request match and the claim use tenant indexes', async () => {
  const scope = await f.otherScope();
  const approver = await f.user();
  await f.member(approver, 'branch_manager', 'BRANCH', scope.branch);
  const request = await f.request({ scope, lines: 2 });
  // بصفوف الطلب وحدها كل فهرس يبان بنفس الثمن، فيقدر المخطط يمسح النشاط من أي مفتاح بيبدأ بـ company_id؛ طلبات تانية لنفس النشاط بتخلي المفاتيح الانتقائية هي الأرخص، زي الإنتاج.
  for (let other = 0; other < 10; other += 1) await f.request({ scope, lines: 20 });
  await f.owner`ANALYZE discount_proposals`;
  await f.owner`ANALYZE discount_approval_notices`;
  const matches = JSON.stringify(await explain(discountApprovalMatchesStatement(request)));
  expect(matches).toMatch(
    /dp_(request_input_key|branch_fk_idx|requested_by_idx|requester_membership_idx)/,
  );
  expect(matches).toMatch(/"Index Cond":"[^"]*\b(request_id|requested_by|branch_id)\b/);
  expect(matches).not.toContain('Seq Scan');
  const claim = JSON.stringify(
    await explain(
      discountApprovalClaimStatement(request, {
        id: f.ids.newId(),
        sourceEventId: request.event.id,
        decidedAt: f.at,
        recipientCount: 1,
      }),
    ),
  );
  expect(claim).toContain('discount_approval_notices_request_key');
  expect(claim).toContain('NOTHING');
  expect(await f.notices(request.requestId)).toHaveLength(1);
}, 120_000);

/** الفهرس مطلوب لا المسح؛ disable_seqscan يجعل الخطة تُظهر الفهرس لا الشامل. */
function explain(statement: SQL) {
  return f.db.withTenant(f.tenant.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
  });
}
