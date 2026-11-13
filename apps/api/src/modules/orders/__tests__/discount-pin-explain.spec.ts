import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { deviceDiscountProposalsStatement } from '../queries/device-discount-proposals.query.ts';
import { discountPinFixture, type DiscountPinFixture } from '../../../../test/discount-pin.fixture.ts';
import { must } from './session.fixture.ts';

let f: DiscountPinFixture;
const NOW = new Date('2026-10-15T08:00:00.000Z');
interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}
const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];

beforeAll(async () => {
  f = await discountPinFixture();
  await seedProposals(f.branch, 60);
  await seedProposals(f.otherBranch, 2000);
  await f.h.owner.unsafe('ANALYZE discount_proposals');
});

afterAll(async () => {
  await f?.close();
});

/** نطاق الجهاز: الشركة والنشاط والفرع وجهاز الفرع المقترن. */
const scope = () => ({
  companyId: f.company,
  businessId: f.business,
  branchId: f.branch,
  deviceId: f.device.id,
});

/** يزرع اقتراحات معلّقة كثيرة، ليختار المخطط فهرساً لا مسحاً كاملاً. */
async function seedProposals(branchId: string, count: number): Promise<void> {
  await f.h.owner`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,kind,session_id,occurred_at,
    customer_id,service_id,service_name_en,service_name_ar,terms,terms_hash,effective_bps,requested_by,requested_by_membership_id,
    requester_limit_source,requester_limit_bps,requester_name_ar,requester_name_en,requester_role,requester_role_is_system,
    requester_role_name_ar,requester_role_name_en,requester_first_name_en,requester_first_name_ar,customer_first_name,requested_at,status,expires_at)
    SELECT ${f.company},gen_random_uuid(),${f.business},${branchId},gen_random_uuid(),0,'RECORD',NULL,
      '2026-10-15T08:00:00Z'::timestamptz,${f.customer},${must(f.services[0])},'Synthetic service 0',NULL,
      '{"list_price":"25.000","price":"25.000","discount":"5.000","net":"20.000"}'::jsonb,
      repeat(md5(gs::text),2),2000,${f.userId},${f.membership},'PERSON',1000,NULL,NULL,'cashier',true,NULL,'Cashier',NULL,NULL,'Synthetic',
      '2026-10-15T08:00:00Z'::timestamptz - gs * interval '1 minute','PENDING','2026-10-20T08:00:00Z'::timestamptz
    FROM generate_series(1,${count}) AS gs`;
}

it('the device statement projects the FR-016 columns and no phone or performer', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    const rows = await tx.execute<Record<string, unknown>>(
      deviceDiscountProposalsStatement(scope(), { limit: 20 }, NOW),
    );
    expect(rows.length).toBeGreaterThan(0);
    const columns = Object.keys(must(rows[0]));
    expect(columns).toEqual(expect.arrayContaining([
      'id',
      'request_id',
      'kind',
      'service_name_en',
      'list_price',
      'price',
      'discount',
      'net',
      'effective_bps',
      'terms_hash',
      'requester_first_name_en',
      'requester_first_name_ar',
      'customer_first_name',
      'requested_at',
      'expires_at',
    ]));
    expect(columns).not.toContain('phone');
    expect(columns).not.toContain('performers');
    expect(columns).not.toContain('performer_ids');
    expect(must(rows[0])['list_price']).toBe('25.000');
    expect(must(rows[0])['effective_bps']).toBe(2000);
  });
});

it('the device statement reads the pending proposals through an index, well under 200 ms', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode; 'Execution Time': number }[] }>(
      sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${deviceDiscountProposalsStatement(scope(), { limit: 20 }, NOW)}`,
    );
    const reported = must(must(rows[0])['QUERY PLAN'][0]);
    const plan = nodes(reported.Plan);
    const summary = JSON.stringify(plan.map((node) => [node['Node Type'], node['Relation Name'], node['Index Name']]));
    const proposals = plan.filter((node) => node['Relation Name'] === 'discount_proposals');
    expect(proposals.length > 0, summary).toBe(true);
    expect(proposals.every((node) => node['Node Type'] !== 'Seq Scan'), summary).toBe(true);
    expect(
      plan.map((node) => node['Index Name']).some((name) => name === 'dp_pending_idx' || name === 'dp_branch_status_idx'),
      summary,
    ).toBe(true);
    expect(reported['Execution Time'], summary).toBeLessThan(200);
  });
});
