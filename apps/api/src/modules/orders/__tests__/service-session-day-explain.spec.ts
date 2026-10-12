import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { branchDayServiceSessionsStatement } from '../queries/branch-day-service-sessions.query.ts';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
const date = '2026-10-14';
interface PlanNode { 'Node Type': string; 'Relation Name'?: string; 'Index Name'?: string;
  'Actual Rows'?: number; 'Actual Loops'?: number; 'Index Cond'?: string; Plans?: PlanNode[] }
const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];

beforeAll(async () => {
  f = await sessionFixture();
  const sample = await f.create.execute({ ...f.context(), input: f.body() });
  const branches = [f.branch, ids.newId(), ids.newId(), ids.newId()];
  for (const branch of branches.slice(1)) await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${f.company},${branch},${f.business},'Synthetic explain branch')`;
  const data = JSON.stringify(Array.from({ length: 8000 }, (_, n) => ({
    id: ids.newId(), line: ids.newId(), performer: ids.newId(), branch: branches[n % 4],
    day: `2026-10-${String(5 + Math.floor(n / 4) % 10).padStart(2, '0')}`,
    at: `2026-10-${String(5 + Math.floor(n / 4) % 10).padStart(2, '0')}T08:${String(Math.floor(n / 40) % 60).padStart(2, '0')}:00.123456Z`,
    late: n % 23 === 0, append_late: n % 29 === 0,
  })));
  await seed(data, sample.session.id, must(sample.session.lines[0]).id);
  for (const table of ['service_sessions', 'service_lines', 'line_performers']) await f.h.owner.unsafe(`ANALYZE ${table}`);
});
afterAll(async () => { await f?.close(); });

async function seed(data: string, session: string, line: string) {
  await f.h.owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
    occurred_at,recorded_at,business_date,business_timezone,recorded_by,recorded_by_membership_id,late)
    SELECT s.company_id,r.id,s.business_id,r.branch,s.customer_id,s.customer_name,s.customer_phone_masked,r.at::timestamptz,
      s.recorded_at,r.day::date,s.business_timezone,s.recorded_by,s.recorded_by_membership_id,r.late
    FROM jsonb_to_recordset(${data}::text::jsonb) r(id uuid,branch uuid,day text,at text,late boolean)
    CROSS JOIN service_sessions s WHERE s.company_id=${f.company} AND s.id=${session}`;
  await f.h.owner.begin(async (tx) => {
    await tx`INSERT INTO service_lines(company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,
      list_price,price,discount,net,effective_discount_bps,limit_bps_applied,limit_source,name_en,name_ar,catalog_revision,
      rule_kind,rule_pct_bps,rule_fixed_amount,counts_toward_threshold,has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late)
      SELECT l.company_id,r.line,l.business_id,r.id,l.service_id,l.ordinal,l.input_index,l.status,l.revision,
        l.list_price,l.price,l.discount,l.net,l.effective_discount_bps,l.limit_bps_applied,l.limit_source,l.name_en,l.name_ar,l.catalog_revision,
        l.rule_kind,l.rule_pct_bps,l.rule_fixed_amount,l.counts_toward_threshold,l.has_performer_warning,l.recorded_by,l.recorded_by_membership_id,l.recorded_at,r.append_late
      FROM jsonb_to_recordset(${data}::text::jsonb) r(id uuid,line uuid,append_late boolean)
      CROSS JOIN service_lines l WHERE l.company_id=${f.company} AND l.id=${line}`;
    await tx`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,name_ar,not_clocked_in_warning,approved_leave_warning)
      SELECT p.company_id,r.performer,p.business_id,r.line,p.employee_id,p.performer_ordinal,p.share_bps,p.name_en,p.name_ar,p.not_clocked_in_warning,p.approved_leave_warning
      FROM jsonb_to_recordset(${data}::text::jsonb) r(line uuid,performer uuid)
      CROSS JOIN line_performers p WHERE p.company_id=${f.company} AND p.line_id=${line}`;
  });
}

it.each([false, true])('normal planner uses tenant day and child indexes, late=%s, first and cursor pages', async (late) => {
  const scope = { ...f.context(), userId: f.ownerId };
  const page = { date, limit: 20, ...(late ? { late: 'true' as const } : {}) };
  const first = await f.db.withTenant(f.company, (tx) => tx.execute<{ cursor_at: string; cursor_id: string }>(branchDayServiceSessionsStatement(scope, page)));
  expect(first.length).toBeGreaterThan(1);
  const cursor = Buffer.from(JSON.stringify({ v: 1, company: f.company, business: f.business, branch: f.branch, date, late,
    at: must(first[0]).cursor_at, id: must(first[0]).cursor_id })).toString('base64url');
  for (const query of [page, { ...page, cursor }]) {
    await f.db.withTenant(f.company, async (tx) => {
      const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${branchDayServiceSessionsStatement(scope, query)}`);
      const plan = nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan);
      const sessions = plan.filter((node) => node['Relation Name'] === 'service_sessions');
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
      const indexes = plan.map((node) => node['Index Name']);
      expect(indexes).toContain('service_sessions_day_idx');
      if (late) expect(indexes).toContain('service_sessions_late_day_idx');
      expect(indexes).toContain('service_lines_late_session_idx');
      expect(indexes).toContain('service_lines_session_ordinal_key');
      expect(indexes).toContain('line_performers_ordinal_key');
      for (const table of ['service_sessions', 'service_lines', 'line_performers']) {
        expect(plan.filter((node) => node['Relation Name'] === table).every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
      }
      const pageLimit = plan.find((node) => node['Node Type'] === 'Limit');
      expect(pageLimit?.['Actual Rows']).toBeLessThanOrEqual(query.limit + 1);
      for (const child of plan.filter((node) => ['service_lines', 'line_performers'].includes(node['Relation Name'] ?? '') && node['Actual Loops'] !== 1)) {
        expect(child['Actual Loops']).toBeLessThanOrEqual(query.limit + 1);
        expect(child['Index Cond']).toContain('company_id');
      }
    });
  }
});
