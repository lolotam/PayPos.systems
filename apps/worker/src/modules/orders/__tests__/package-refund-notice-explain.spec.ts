import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  packageRefundClaimStatement,
  packageRefundContextStatement,
  packageRefundMatchStatement,
} from '../persistence/package-refund-notice.repository.ts';
import type { PackageRefundNoticeRefund } from '../ports/package-refund-notice.port.ts';
import {
  REFUNDED_AT,
  REFUND_AMOUNT,
  REFUND_BUSINESS_DATE,
  packageRefundNoticeFixture,
  type PackageRefundNoticeFixture,
  type SeededRefund,
} from './package-refund-notice.fixture.ts';

let f: PackageRefundNoticeFixture;
let delivered: SeededRefund;

beforeAll(async () => {
  f = await packageRefundNoticeFixture();
  delivered = await f.refund();
  expect(await f.deliver(delivered.event)).toEqual({ delivered: true });
  await f.owner`ANALYZE package_refund_notices`;
  await f.owner`ANALYZE package_refunds`;
  await f.owner`ANALYZE package_entitlements`;
  await f.owner`ANALYZE branches`;
  await f.owner`ANALYZE businesses`;
});

afterAll(async () => {
  await f?.close();
});

function refundInput(seeded: SeededRefund): PackageRefundNoticeRefund {
  return {
    companyId: f.companyId,
    businessId: f.businessId,
    branchId: f.branchId,
    entitlementId: seeded.entitlement,
    componentId: seeded.component,
    refundId: seeded.refund,
    sessions: 1,
    amount: REFUND_AMOUNT,
    businessDate: REFUND_BUSINESS_DATE,
    refundedAt: REFUNDED_AT,
    entitlementRevision: 2,
  };
}

function explain(statement: SQL, noSeqScan: boolean) {
  return f.db.withTenant(f.companyId, async (tx) => {
    if (noSeqScan) await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
  });
}

it('the claim plan uses package_refund_notices_refund_key and does nothing on conflict', async () => {
  const statement = packageRefundClaimStatement(refundInput(delivered), {
    id: f.ids.newId(),
    sourceEventId: delivered.event.id,
    decidedAt: f.at,
    recipientCount: 2,
  });
  const plan = JSON.stringify(await explain(statement, true));
  expect(plan).toContain('"Conflict Resolution":"NOTHING"');
  expect(plan).toContain('package_refund_notices_refund_key');
  expect(await f.notices(delivered.refund)).toHaveLength(1);
});

const REFUND_INDEXES =
  /package_refunds_history_idx|package_refunds_business_id_key|package_refunds_pkey/;
const ENTITLEMENT_INDEXES =
  /package_entitlements_customer_read_idx|package_entitlements_business_id_key|package_entitlements_pkey/;

it('the match query runs on indexed scans without sequential scans', async () => {
  const plan = JSON.stringify(
    await explain(packageRefundMatchStatement(refundInput(delivered)), true),
  );
  expect(plan).toMatch(REFUND_INDEXES);
  expect(plan).toMatch(ENTITLEMENT_INDEXES);
  expect(plan).not.toContain('Seq Scan');
});

it('the context query runs on indexed scans without sequential scans', async () => {
  const plan = JSON.stringify(
    await explain(packageRefundContextStatement(refundInput(delivered)), true),
  );
  expect(plan).toMatch(ENTITLEMENT_INDEXES);
  expect(plan).not.toContain('Seq Scan');
});
