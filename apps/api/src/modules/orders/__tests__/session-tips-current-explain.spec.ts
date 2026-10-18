import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { sessionTipsCurrentStatement } from '../queries/session-tips-current.query.ts';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
let sessionId = '';
interface PlanNode { 'Node Type': string; 'Relation Name'?: string; 'Index Name'?: string; Plans?: PlanNode[] }
const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];

beforeAll(async () => {
  f = await sessionFixture();
  const saved = await f.create.execute({ ...f.context(), input: f.body() });
  sessionId = saved.session.id;
  await seed(sessionId);
  await f.h.owner.unsafe('ANALYZE session_tip_revisions, session_tips');
});
afterAll(async () => { await f?.close(); });

async function seed(sample: string) {
  const extras = Array.from({ length: 3999 }, () => ({ id: ids.newId(), rev: ids.newId(), tip: ids.newId() }));
  const copies = JSON.stringify(extras);
  const all = JSON.stringify([{ id: sample, rev: ids.newId(), tip: ids.newId() }, ...extras]);
  const employee = must(f.employees[0]);
  await f.h.owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
    occurred_at,recorded_at,business_date,business_timezone,recorded_by,recorded_by_membership_id,late)
    SELECT s.company_id,r.id,s.business_id,s.branch_id,s.customer_id,s.customer_name,s.customer_phone_masked,
      s.occurred_at,s.recorded_at,s.business_date,s.business_timezone,s.recorded_by,s.recorded_by_membership_id,s.late
    FROM jsonb_to_recordset(${copies}::text::jsonb) r(id uuid)
    CROSS JOIN service_sessions s WHERE s.company_id=${f.company} AND s.id=${sample}`;
  await f.h.owner.begin(async (tx) => {
    await tx`INSERT INTO session_tip_revisions(company_id,id,business_id,session_id,revision,previous_revision,
      changed_by,changed_by_membership_id,changed_at,reason,event_id,write_xid)
      SELECT ${f.company},r.rev,${f.business},r.id,1,NULL,${f.userId},${f.membership},now(),NULL,gen_random_uuid(),'0'::xid8
      FROM jsonb_to_recordset(${all}::text::jsonb) r(id uuid, rev uuid)`;
    await tx`INSERT INTO session_tips(company_id,id,business_id,revision_id,session_id,employee_id,method,amount)
      SELECT ${f.company},r.tip,${f.business},r.rev,r.id,${employee},'CASH',1.000
      FROM jsonb_to_recordset(${all}::text::jsonb) r(id uuid, rev uuid, tip uuid)`;
  });
}

it('reads the current revision and its entries through the tip indexes', async () => {
  const scope = { ...f.context(), sessionId };
  await f.db.withTenant(f.company, async (tx) => {
    const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${sessionTipsCurrentStatement(scope)}`);
    const plan = nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan);
    for (const table of ['session_tip_revisions', 'session_tips']) {
      const scans = plan.filter((node) => node['Relation Name'] === table);
      expect(scans.length).toBeGreaterThan(0);
      expect(scans.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
    }
    const indexes = plan.map((node) => node['Index Name']);
    expect(indexes).toContain('session_tip_revisions_session_revision_uq');
    expect(indexes).toContain('session_tips_session_revision_idx');
  }, { userId: f.userId });
});
