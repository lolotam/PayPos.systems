import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { currentSessionTipsStatement } from '../queries/session-tips-bootstrap.query.ts';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
let sessionId = '';
interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  'Rows Removed by Filter'?: number;
  Plans?: PlanNode[];
}
const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];

beforeAll(async () => {
  f = await sessionFixture();
  const saved = await f.create.execute({ ...f.context(), input: f.body() });
  sessionId = saved.session.id;
  await seed(sessionId);
  await f.h.owner.unsafe('ANALYZE service_sessions, session_tip_revisions, session_tips');
});
afterAll(async () => { await f?.close(); });

async function seed(sample: string) {
  const extras = Array.from({ length: 7999 }, (_, n) => ({ id: ids.newId(), rev: ids.newId(), tip: ids.newId(), n: (n % 200) + 1 }));
  const copies = JSON.stringify(extras);
  const all = JSON.stringify([{ id: sample, rev: ids.newId(), tip: ids.newId() }, ...extras]);
  const employee = must(f.employees[0]);
  await f.h.owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
    occurred_at,recorded_at,business_date,business_timezone,recorded_by,recorded_by_membership_id,late)
    SELECT s.company_id,r.id,s.business_id,s.branch_id,s.customer_id,s.customer_name,s.customer_phone_masked,
      s.occurred_at,s.recorded_at,s.business_date - r.n,s.business_timezone,s.recorded_by,s.recorded_by_membership_id,s.late
    FROM jsonb_to_recordset(${copies}::text::jsonb) r(id uuid, n int)
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

it('pages current revisions without sequential scans on the session or tip tables', async () => {
  // الصفحة بتُقاد من زيارات اليوم بمفتاح (اليوم، المعرّف) على فهرس (company_id, business_id, business_date, id)
  // اللي صف 50-0 نزله مع هجرة الفهارس (مشكلة #649)، فالمخطط يمشي على أيام النشاط بدل تاريخ المراجعات كله.
  const [row] = await f.h.owner`SELECT to_char(business_date,'YYYY-MM-DD') AS day FROM service_sessions WHERE company_id=${f.company} AND id=${sessionId}`;
  const day = String(must(row)['day']);
  const from = new Date(new Date(`${day}T00:00:00Z`).getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
  const statement = currentSessionTipsStatement(f.company, f.business, { from, to: day }, { after: null, limit: 50 });
  await f.db.withTenant(f.company, async (tx) => {
    const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`);
    const plan = nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan);
    for (const table of ['session_tip_revisions', 'session_tips', 'service_sessions']) {
      const scans = plan.filter((node) => node['Relation Name'] === table);
      expect(scans.length).toBeGreaterThan(0);
      expect(scans.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
    }
    // الفهرسان يبدأان بالشركة والزيارة، والمخطط يختار بينهما بالإحصاء؛ المهم مسار مفهرس بالزيارة بلا مسح تسلسلي.
    const used = plan.map((node) => node['Index Name']);
    expect(['session_tip_revisions_session_revision_uq', 'session_tip_revisions_previous_idx'].some((name) => used.includes(name))).toBe(true);
    // صفحة الخمسين لازم تقرأ زيارات الصفحة نفسها مش زيارات النشاط كله؛ الفهرس الجديد هو اللي بيضمن ده.
    expect(used).toContain('service_sessions_business_day_idx');
    const visits = plan.filter((node) => node['Relation Name'] === 'service_sessions');
    const scanned = visits.reduce((sum, node) => sum + (node['Actual Rows'] ?? 0), 0);
    const removed = visits.reduce((sum, node) => sum + (node['Rows Removed by Filter'] ?? 0), 0);
    expect(scanned).toBeGreaterThanOrEqual(50);
    expect(scanned).toBeLessThan(500);
    expect(removed).toBeLessThan(50);
  }, { userId: f.userId });
});
