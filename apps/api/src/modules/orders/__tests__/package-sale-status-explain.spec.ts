import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  packageSaleStatusStatement,
  type PackageSaleLookup,
} from '../queries/package-sale-status.query.ts';
import { insertSaleRequestRow } from './package-sale-request.fixture.ts';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
let saleRequestId = '';

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];

beforeAll(async () => {
  f = await sessionFixture();
  saleRequestId = await insertSaleRequestRow(f);
  await seed(saleRequestId);
  await f.h.owner.unsafe('ANALYZE package_sale_requests');
});

afterAll(async () => {
  await f?.close();
});

async function seed(sample: string) {
  const extras = Array.from({ length: 499 }, () => ({ id: ids.newId() }));
  const copies = JSON.stringify(extras);
  await f.h.owner`INSERT INTO package_sale_requests
    (company_id, id, business_id, branch_id, recorded_by, recorded_by_membership_id,
     discount_limit_bps, customer_id, package_type_id, expected_type_revision,
     expected_service_revisions, price_paid, paid_method, seller_employee_id, sold_at,
     status)
    SELECT s.company_id, r.id, s.business_id, s.branch_id, s.recorded_by, s.recorded_by_membership_id,
      s.discount_limit_bps, s.customer_id, s.package_type_id, s.expected_type_revision,
      s.expected_service_revisions, s.price_paid, s.paid_method, s.seller_employee_id, s.sold_at,
      s.status
    FROM jsonb_to_recordset(${copies}::text::jsonb) r(id uuid)
    CROSS JOIN package_sale_requests s WHERE s.company_id = ${f.company} AND s.id = ${sample}`;
}

it('reads the package sale request status using an index scan and no sequential scan', async () => {
  const actor: PackageSaleLookup = {
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    branchId: f.branch,
    saleRequestId,
  };

  await f.db.withTenant(
    f.company,
    async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
        sql`EXPLAIN (ANALYZE, FORMAT JSON) ${packageSaleStatusStatement(actor)}`,
      );
      const plan = nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan);
      const scans = plan.filter((node) => node['Relation Name'] === 'package_sale_requests');
      expect(scans.length).toBeGreaterThan(0);
      expect(scans.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
      const indexNames = plan.flatMap((node) => (node['Index Name'] ? [node['Index Name']] : []));
      expect(indexNames.length).toBeGreaterThan(0);
      expect(indexNames.some((name) => name.startsWith('package_sale_requests_'))).toBe(true);
    },
    { userId: f.userId },
  );
});
