import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { serviceLineCancellationStatement } from '../queries/service-line-cancellation.query.ts';
import { must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
let sessionId = '';
let lineId = '';
interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}
const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];

beforeAll(async () => {
  f = await sessionFixture();
  const saved = await f.create.execute({ ...f.context(), input: f.body() });
  const sampleSession = saved.session.id;
  const sampleLine = must(saved.session.lines[0]).id;
  await seedCopies(sampleSession, sampleLine);
  const picked = await f.h.owner<
    { id: string; session_id: string }[]
  >`SELECT id,session_id FROM service_lines
    WHERE company_id=${f.company} AND status='CANCELLED' LIMIT 1`;
  lineId = must(picked[0]).id;
  sessionId = must(picked[0]).session_id;
  await f.h.owner.unsafe('ANALYZE service_line_cancellations');
});
afterAll(async () => {
  await f?.close();
});

async function seedCopies(sampleSession: string, sampleLine: string) {
  await f.h.owner.begin(async (tx) => {
    await tx`WITH src AS (
      SELECT gen_random_uuid() AS session_id, gen_random_uuid() AS line_id FROM generate_series(1,8000)
    ), sessions AS (
      INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
        occurred_at,recorded_at,business_date,business_timezone,recorded_by,recorded_by_membership_id,late)
      SELECT s.company_id,src.session_id,s.business_id,s.branch_id,s.customer_id,s.customer_name,s.customer_phone_masked,
        s.occurred_at,s.recorded_at,s.business_date,s.business_timezone,s.recorded_by,s.recorded_by_membership_id,s.late
      FROM src CROSS JOIN service_sessions s WHERE s.company_id=${f.company} AND s.id=${sampleSession}
      RETURNING id
    ), lines AS (
      INSERT INTO service_lines(company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,
        list_price,price,discount,net,effective_discount_bps,limit_bps_applied,limit_source,name_en,name_ar,catalog_revision,
        rule_kind,rule_pct_bps,rule_fixed_amount,counts_toward_threshold,has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late)
      SELECT l.company_id,src.line_id,l.business_id,src.session_id,l.service_id,l.ordinal,l.input_index,l.status,l.revision,
        l.list_price,l.price,l.discount,l.net,l.effective_discount_bps,l.limit_bps_applied,l.limit_source,l.name_en,l.name_ar,l.catalog_revision,
        l.rule_kind,l.rule_pct_bps,l.rule_fixed_amount,l.counts_toward_threshold,l.has_performer_warning,
        l.recorded_by,l.recorded_by_membership_id,l.recorded_at,l.late
      FROM src JOIN sessions ON sessions.id=src.session_id
      CROSS JOIN service_lines l WHERE l.company_id=${f.company} AND l.id=${sampleLine}
      RETURNING id
    )
    INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,name_ar,not_clocked_in_warning,approved_leave_warning)
    SELECT p.company_id,gen_random_uuid(),p.business_id,src.line_id,p.employee_id,p.performer_ordinal,p.share_bps,
      p.name_en,p.name_ar,p.not_clocked_in_warning,p.approved_leave_warning
    FROM src JOIN lines ON lines.id=src.line_id
    JOIN line_performers p ON p.company_id=${f.company} AND p.line_id=${sampleLine}`;
    await tx`UPDATE service_lines SET status='CANCELLED', revision=revision+1
      WHERE company_id=${f.company} AND session_id<>${sampleSession} AND status='ACTIVE'`;
    await tx`INSERT INTO service_line_cancellations(company_id,id,business_id,line_id,revision,previous_revision,
      previous_price,previous_discount,previous_net,cancelled_by,cancelled_by_membership_id,cancelled_at,reason,
      canceller_name_ar,canceller_name_en,canceller_role,canceller_role_is_system,canceller_role_name_ar,canceller_role_name_en)
      SELECT l.company_id,gen_random_uuid(),l.business_id,l.id,l.revision,l.revision-1,l.price,l.discount,l.net,
        l.recorded_by,l.recorded_by_membership_id,l.recorded_at,'Cancelled',NULL,'Synthetic canceller',NULL,NULL,NULL,NULL
      FROM service_lines l WHERE l.company_id=${f.company} AND l.session_id<>${sampleSession}`;
  });
}

it('reads one cancellation through slc_line_uq or slc_line_fk_idx without a sequential scan', async () => {
  const scope = { ...f.context(), userId: f.ownerId, sessionId, lineId };
  await f.db.withTenant(f.company, async (tx) => {
    const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
      sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${serviceLineCancellationStatement(scope)}`,
    );
    const plan = nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan);
    const history = plan.filter((node) => node['Relation Name'] === 'service_line_cancellations');
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
    const indexes = plan.map((node) => node['Index Name']);
    expect(indexes.includes('slc_line_uq') || indexes.includes('slc_line_fk_idx')).toBe(true);
  });
});
