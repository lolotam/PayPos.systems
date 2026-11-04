import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import type { DiscountSelfApprovalNoticeEvent } from '../ports/discount-self-approval-notice.port.ts';
import {
  discountSelfApprovalClaimStatement,
  discountSelfApprovalMatchesStatement,
} from '../persistence/discount-self-approval-notice.repository.ts';
import type { PreparedDecision } from './discount-self-approval-notice-data.ts';
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

// حجم تمثيلي لنفس النشاط والفرع: بلا مسح شامل يكون معقولاً، فثبوت الخطة الطبيعية غير المجبورة هو الدليل المطلوب.
const EXTRA_PROPOSALS = 400;

it('unforced production plan at volume: the match uses the proposals primary key and the claim probes the source-event unique key', async () => {
  const prepared = await f.decision({ proposals: 2 });
  for (let other = 0; other < EXTRA_PROPOSALS; other += 1) await f.decision({ proposals: 1 });
  await f.owner`ANALYZE discount_proposals`;
  await f.owner`ANALYZE discount_self_approval_notices`;
  const event = eventOf(prepared);
  // EXPLAIN ANALYZE تحت سياق المستأجر وبلا أي تثبيت مخطط: الفهرس الفعلي والمسند الفعلي وعمل مردودي محدود.
  const matches = JSON.stringify(await explain(discountSelfApprovalMatchesStatement(event)));
  // الخطة الطبيعية الراسخة (400+ مقترحاً لنفس النشاط): المخطط يختار أحد مفاتيح company_id,id المعادلة —
  // dp_consumed_line_binding_key (يضع business_id أيضاً في Index Cond) أو dp_pk أو dp_business_id_key
  // أو dp_consumed_line_key أو dp_consumed_edit_key، كلها موثقة في schema orders-discount-proposals.ts.
  expect(matches).toMatch(
    /"Index Name":"(dp_consumed_line_binding_key|dp_business_id_key|dp_consumed_line_key|dp_consumed_edit_key|dp_pk)"/,
  );
  expect(matches).toMatch(/"Index Cond":"[^"]*\bcompany_id\b/);
  expect(matches).toMatch(/"Index Cond":"[^"]*\bid\b/);
  expect(matches).not.toContain('Seq Scan');
  // كل مقترح معلن يوصل بمفتاحه فقط: صفان مردودان وبلا صفوف مقصوفة، فالمطابقة عمل محدود مهما كبر الجدول.
  expect(matches).toContain('"Actual Rows":2');
  expect(matches).toContain('"Rows Removed by Filter":0');
  // EXPLAIN ANALYZE ينفّذ الإدخال فعلاً: أول جملة تدخل الصف، والثانية لنفس الحدث تصطدم ولا تدخل شيئًا.
  const insert = JSON.stringify(await explain(claimStatement(event, f.ids.newId())));
  expect(insert).toContain('discount_self_approval_notices_source_event_key');
  expect(insert).toContain('"Conflict Resolution":"NOTHING"');
  expect(await f.notices(prepared.companyId, prepared.event.id)).toHaveLength(1);
  const conflict = JSON.stringify(await explain(claimStatement(event, f.ids.newId())));
  expect(conflict).toContain('discount_self_approval_notices_source_event_key');
  expect(conflict).toContain('"Conflict Resolution":"NOTHING"');
  expect(await f.notices(prepared.companyId, prepared.event.id)).toHaveLength(1);
}, 120_000);

it('forced planner (index eligibility only): with seq scans disabled the match still reaches the proposals by key', async () => {
  const prepared = await f.decision({ proposals: 2 });
  await f.owner`ANALYZE discount_proposals`;
  const event = eventOf(prepared);
  // دليل أهلية فهرس بس: disable_seqscan يجبر الخطة على إظهار الفهرس، فلا يُعدّ دليل خطة إنتاج طبيعية.
  const matches = JSON.stringify(await forcedExplain(discountSelfApprovalMatchesStatement(event)));
  expect(matches).toMatch(
    /"Index Name":"(dp_consumed_line_binding_key|dp_business_id_key|dp_consumed_line_key|dp_consumed_edit_key|dp_pk)"/,
  );
  expect(matches).toMatch(/"Index Cond":"[^"]*\bcompany_id\b/);
  expect(matches).toMatch(/"Index Cond":"[^"]*\bid\b/);
  expect(matches).not.toContain('Seq Scan');
}, 120_000);

it('the match statement returns exactly the stored fact columns for the flagged proposals', async () => {
  const prepared = await f.decision({ proposals: 2 });
  const rows = await f.db.withTenant(prepared.companyId, (tx) =>
    tx.execute(discountSelfApprovalMatchesStatement(eventOf(prepared))),
  );
  expect(rows).toHaveLength(2);
  for (const row of rows)
    expect(Object.keys(row).sort()).toEqual([
      'decided_by',
      'decided_via',
      'effective_bps',
      'id',
      'service_id',
    ]);
});

/** حدث القرار كما ينتجه المعالج من الغلاف الموثوق والحمولة المُتحققة. */
function eventOf(prepared: PreparedDecision): DiscountSelfApprovalNoticeEvent {
  const payload = prepared.event.payload as {
    proposals: {
      id: string;
      service_id: string;
      name_en: string;
      name_ar: string | null;
      effective_bps: number;
    }[];
  };
  return {
    companyId: prepared.companyId,
    sourceEventId: prepared.event.id,
    businessId: prepared.businessId,
    branchId: prepared.branchId,
    decidedBy: prepared.decidedBy,
    deciderLabelAr: 'موافق تجريبي',
    deciderLabelEn: 'Synthetic decider',
    decidedVia: 'REMOTE',
    proposals: payload.proposals.map((proposal) => ({
      id: proposal.id,
      serviceId: proposal.service_id,
      nameAr: proposal.name_ar,
      nameEn: proposal.name_en,
      effectiveBps: proposal.effective_bps,
    })),
  };
}

function claimStatement(event: DiscountSelfApprovalNoticeEvent, id: string) {
  return discountSelfApprovalClaimStatement(event, {
    id,
    sourceEventId: event.sourceEventId,
    decidedAt: f.at,
    recipientCount: 1,
  });
}

/** خطة طبيعية بلا تثبيت مخطط، تحت سياق مستأجر pospay_app كما يفتحها التوصيل. */
function explain(statement: SQL) {
  return f.db.withTenant(f.tenant.company, (tx) =>
    tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`),
  );
}

/** أهلية الفهرس فقط: لا يُستعمل كدليل خطة إنتاج طبيعية. */
function forcedExplain(statement: SQL) {
  return f.db.withTenant(f.tenant.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
  });
}
