import { customerPackageDetail } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { packageEntitlementDetailStatement } from '../queries/package-entitlement-detail.query.ts';
import {
  packageRefundFixture,
  postRefund,
  refundBody,
  seedSoldPackage,
  type PackageRefundFixture,
} from './package-refund.fixture.ts';
import { AT, ids, must, type SessionFixture } from './session.fixture.ts';

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
const detailPath = (f: SessionFixture, entitlementId: string) =>
  `/v1/businesses/${f.business}/branches/${f.branch}/customers/${f.customer}/packages/${entitlementId}`;

let fx: PackageRefundFixture;

beforeAll(async () => {
  fx = await packageRefundFixture();
});

beforeEach(() => {
  fx.setAt(AT);
});

afterAll(async () => {
  await fx?.f.close();
});

it('sets can_refund from the acting branch and flips to false on DENY override', async () => {
  const { f, sold } = fx;
  const allowRes = await f.h.send('GET', detailPath(f, sold.entitlement), {
    cookie: f.cookie,
    company: f.company,
  });
  expect(allowRes.status).toBe(200);
  expect(customerPackageDetail.parse(allowRes.body).can_refund).toBe(true);

  const deny = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${deny},${f.membership},'refund:packages:branch','DENY','BRANCH',${f.branch},
      'Synthetic refund deny',${f.ownerId})`;
  try {
    const denyRes = await f.h.send('GET', detailPath(f, sold.entitlement), {
      cookie: f.cookie,
      company: f.company,
    });
    expect(denyRes.status).toBe(200);
    expect(customerPackageDetail.parse(denyRes.body).can_refund).toBe(false);
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE id=${deny}`;
  }
});

async function expectRefundsIndexScan(f: SessionFixture, entitlementId: string) {
  await f.h.owner.unsafe('ANALYZE package_refunds');
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${packageEntitlementDetailStatement(
        f.company,
        f.business,
        entitlementId,
      )}`,
    );
    const scans = nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan).filter(
      (node) => node['Relation Name'] === 'package_refunds',
    );
    expect(scans.length).toBeGreaterThan(0);
    expect(scans.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
    expect(
      scans.some((node) =>
        [
          'package_refunds_history_idx',
          'package_refunds_entitlement_fk_idx',
          'package_refunds_entitlement_revision_key',
        ].includes(node['Index Name'] ?? ''),
      ),
    ).toBe(true);
  });
}

it('projects refund history newest-first without actor ids and scans via package_refunds index', async () => {
  const { f } = fx;
  const seeded = await seedSoldPackage(f, { sessions: 4 });
  const first = await postRefund(f, seeded.entitlement, {
    body: refundBody({
      component_id: seeded.component,
      sessions: 1,
      method: 'CASH',
      reason: 'First',
    }),
  });
  expect(first.status).toBe(201);
  fx.setAt(new Date('2026-10-16T08:00:00.000Z'));
  const second = await postRefund(f, seeded.entitlement, {
    body: refundBody({
      component_id: seeded.component,
      sessions: 1,
      method: 'CARD',
      reason: 'Second',
    }),
  });
  expect(second.status).toBe(201);

  const res = await f.h.send('GET', detailPath(f, seeded.entitlement), {
    cookie: f.cookie,
    company: f.company,
  });
  expect(res.status).toBe(200);
  const detail = customerPackageDetail.parse(res.body);
  expect(detail.refunds.map((row) => [row.method, row.reason])).toEqual([
    ['CARD', 'Second'],
    ['CASH', 'First'],
  ]);
  const serialized = JSON.stringify(detail.refunds);
  expect(serialized).not.toContain(f.membership);
  expect(serialized).not.toContain('refunded_by');
  await expectRefundsIndexScan(f, seeded.entitlement);
});
