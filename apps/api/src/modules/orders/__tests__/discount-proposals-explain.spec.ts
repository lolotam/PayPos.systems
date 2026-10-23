import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { pendingDiscountProposalsStatement } from '../queries/pending-discount-proposals.query.ts';
import { requesterDiscountProposalsStatement } from '../queries/requester-discount-proposals.query.ts';
import { ids, must, discountRequestFixture, type DiscountRequestFixture } from './session.fixture.ts';

let f: DiscountRequestFixture;
let requestId = '';
let seededId = '';
const NOW = new Date('2026-10-15T08:00:00.000Z');
interface PlanNode { 'Node Type': string; 'Relation Name'?: string; 'Index Name'?: string; Plans?: PlanNode[] }
const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];

beforeAll(async () => {
  f = await discountRequestFixture();
  requestId = ids.newId();
  await f.h.owner`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,kind,session_id,occurred_at,
    customer_id,service_id,service_name_en,service_name_ar,terms,terms_hash,effective_bps,requested_by,requested_by_membership_id,
    requester_limit_source,requester_limit_bps,requester_name_ar,requester_name_en,requester_role,requester_role_is_system,
    requester_role_name_ar,requester_role_name_en,requester_first_name_en,requester_first_name_ar,customer_first_name,requested_at,status,expires_at)
    SELECT ${f.company},gen_random_uuid(),${f.business},${f.branch},gen_random_uuid(),0,'RECORD',NULL,
      '2026-10-15T08:00:00.000Z'::timestamptz,${f.customer},${must(f.services[0])},'Synthetic service 0',NULL,'{}'::jsonb,
      repeat(md5(gs::text),2),2000,${f.userId},${f.membership},'PERSON',1000,NULL,NULL,'cashier',true,NULL,'Cashier',NULL,NULL,'Synthetic',
      '2026-10-15T08:00:00.000Z'::timestamptz,'PENDING','2026-10-20T08:00:00.000Z'::timestamptz
    FROM generate_series(1,3000) AS gs`;
  await f.h.owner`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,kind,session_id,occurred_at,
    customer_id,service_id,service_name_en,service_name_ar,terms,terms_hash,effective_bps,requested_by,requested_by_membership_id,
    requester_limit_source,requester_limit_bps,requester_name_ar,requester_name_en,requester_role,requester_role_is_system,
    requester_role_name_ar,requester_role_name_en,requester_first_name_en,requester_first_name_ar,customer_first_name,requested_at,status,expires_at)
    VALUES(${f.company},${ids.newId()},${f.business},${f.branch},${requestId},0,'RECORD',NULL,
      '2026-10-15T08:00:00.000Z'::timestamptz,${f.customer},${must(f.services[0])},'Synthetic service 0',NULL,'{}'::jsonb,
      ${'a'.repeat(64)},2000,${f.userId},${f.membership},'PERSON',1000,NULL,NULL,'cashier',true,NULL,'Cashier',NULL,NULL,'Synthetic',
      '2026-10-15T08:00:00.000Z'::timestamptz,'PENDING','2026-10-20T08:00:00.000Z'::timestamptz)`;
  await f.h.owner`INSERT INTO discount_proposal_performers(company_id,id,business_id,proposal_id,employee_id,linked_user_id,first_name_en,first_name_ar)
    SELECT ${f.company},gen_random_uuid(),${f.business},d.id,${must(f.employees[1])},NULL,'Sara','سارة'
    FROM discount_proposals d WHERE d.company_id=${f.company} AND d.business_id=${f.business}`;
  await f.h.owner.unsafe('ANALYZE discount_proposals, discount_proposal_performers');
  const [row] = await f.h.owner`SELECT id FROM discount_proposals WHERE company_id=${f.company} AND request_id<>${requestId} LIMIT 1`;
  seededId = must(row)['id'] as string;
});
afterAll(async () => { await f?.close(); });

const scope = () => ({ companyId: f.company, userId: f.userId, businessId: f.business, branchId: f.branch });

it('the requester statement reads its own request through dp_request_input_key', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
      sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${requesterDiscountProposalsStatement(scope(), requestId, NOW)}`);
    const plan = nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan);
    const proposals = plan.filter((node) => node['Relation Name'] === 'discount_proposals');
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
    expect(plan.map((node) => node['Index Name'])).toContain('dp_request_input_key');
  });
});

it('the pending statement reads the live proposals through dp_pending_idx and the performers through their index', async () => {
  const cursor = Buffer.from(JSON.stringify({
    v: 1, company: f.company, business: f.business, branch: f.branch, at: '2026-10-15T08:00:00.000000Z', id: seededId,
  })).toString('base64url');
  for (const query of [{ limit: 20 }, { limit: 20, cursor }]) {
    await f.db.withTenant(f.company, async (tx) => {
      const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
        sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${pendingDiscountProposalsStatement(scope(), query, NOW)}`);
      const plan = nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan);
      const proposals = plan.filter((node) => node['Relation Name'] === 'discount_proposals');
      const performers = plan.filter((node) => node['Relation Name'] === 'discount_proposal_performers');
      expect(proposals.length).toBeGreaterThan(0);
      expect(performers.length).toBeGreaterThan(0);
      expect(proposals.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
      expect(performers.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
      expect(plan.map((node) => node['Index Name'])).toContain('dp_pending_idx');
      expect(plan.map((node) => node['Index Name'])).toContain('dpp_proposal_fk_idx');
    });
  }
});
