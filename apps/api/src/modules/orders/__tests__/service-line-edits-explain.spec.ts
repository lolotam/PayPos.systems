import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { serviceLineEditsStatement } from '../queries/service-line-edits.query.ts';
import { must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
let sessionId = '';
let lineId = '';
interface PlanNode { 'Node Type': string; 'Relation Name'?: string; 'Index Name'?: string; Plans?: PlanNode[] }
const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];

beforeAll(async () => {
  f = await sessionFixture();
  const saved = await f.create.execute({ ...f.context(), input: f.body() });
  sessionId = saved.session.id;
  lineId = must(saved.session.lines[0]).id;
  await f.h.owner`INSERT INTO service_line_edits(company_id,id,business_id,line_id,revision,previous_revision,
    previous_price,previous_discount,previous_net,new_price,new_discount,new_net,
    previous_effective_discount_bps,previous_limit_bps_applied,previous_limit_source,
    new_effective_discount_bps,new_limit_bps_applied,new_limit_source,reason,changed_at,changed_by,changed_by_membership_id,
    editor_name_ar,editor_name_en,editor_role,editor_role_is_system,editor_role_name_ar,editor_role_name_en)
    SELECT ${f.company},gen_random_uuid(),${f.business},${lineId}::uuid,rev::int,(rev-1)::int,
      25.000,0.000,25.000,22.000,2.000,20.000,0,NULL,'OWNER',0,NULL,'OWNER',
      'Synthetic edit reason','2026-10-14T08:00:06.000000Z'::timestamptz,${f.userId},${f.membership},
      NULL,'Synthetic editor','owner',true,NULL,'Owner'
    FROM generate_series(2,8001) AS rev`;
  await f.h.owner.unsafe('ANALYZE service_line_edits');
});
afterAll(async () => { await f?.close(); });

it('scans history through service_line_edits_line_revision_key on the first page and a revision cursor', async () => {
  const scope = { ...f.context(), userId: f.ownerId, sessionId, lineId };
  const cursor = Buffer.from(JSON.stringify({ v: 1, company: f.company, business: f.business, branch: f.branch,
    session: sessionId, line: lineId, revision: 4000 })).toString('base64url');
  for (const query of [{ limit: 50 }, { limit: 50, cursor }]) {
    await f.db.withTenant(f.company, async (tx) => {
      const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${serviceLineEditsStatement(scope, query)}`);
      const plan = nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan);
      const edits = plan.filter((node) => node['Relation Name'] === 'service_line_edits');
      expect(edits.length).toBeGreaterThan(0);
      expect(edits.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
      expect(plan.map((node) => node['Index Name'])).toContain('service_line_edits_line_revision_key');
    });
  }
});
