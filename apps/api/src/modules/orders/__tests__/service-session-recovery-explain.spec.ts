import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { sessionRecoveryStatement } from '../queries/session-recovery.query.ts';
import { recoveryKeyHash } from '../persistence/session-recovery.adapter.ts';
import { AT, ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
const key = ids.newId();
interface PlanNode { 'Node Type': string; 'Relation Name'?: string; 'Index Name'?: string; Plans?: PlanNode[] }
const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];

beforeAll(async () => {
  f = await sessionFixture();
  const saved = await f.create.execute({ ...f.context(key), input: f.body() });
  await f.h.owner`UPDATE service_session_recoveries SET last_seen_at = issued_at - interval '25 hours'
    WHERE company_id=${f.company} AND key_hash=${recoveryKeyHash(key)}`;
  const proofs = JSON.stringify(Array.from({ length: 2000 }, () => ({ id: ids.newId(), hash: ids.newId() })));
  const visits = JSON.stringify(Array.from({ length: 8000 }, (_, n) => {
    const day = n < 400 ? '2026-10-14' : `2026-09-${String((n % 28) + 1).padStart(2, '0')}`;
    return { id: ids.newId(), line: ids.newId(), day, at: `${day}T08:${String(n % 60).padStart(2, '0')}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}.000000Z` };
  }));
  await f.h.owner`INSERT INTO service_session_recoveries(company_id,id,business_id,branch_id,user_id,operation,key_hash,business_date,business_timezone,issued_at,last_seen_at,expires_at)
    SELECT p.company_id,r.id,p.business_id,p.branch_id,p.user_id,p.operation,r.hash,p.business_date,p.business_timezone,p.issued_at,p.last_seen_at,p.expires_at
    FROM jsonb_to_recordset(${proofs}::text::jsonb) r(id uuid,hash text)
    CROSS JOIN service_session_recoveries p WHERE p.company_id=${f.company} AND p.key_hash=${recoveryKeyHash(key)}`;
  await f.h.owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
      occurred_at,recorded_at,business_date,business_timezone,recorded_by,recorded_by_membership_id,late)
    SELECT s.company_id,r.id,s.business_id,s.branch_id,s.customer_id,s.customer_name,s.customer_phone_masked,r.at::timestamptz,
      s.recorded_at,r.day::date,s.business_timezone,s.recorded_by,s.recorded_by_membership_id,s.late
    FROM jsonb_to_recordset(${visits}::text::jsonb) r(id uuid,at text,day text)
    CROSS JOIN service_sessions s WHERE s.company_id=${f.company} AND s.id=${saved.session.id}`;
  const sourceLine = must(saved.session.lines[0]).id;
  await f.h.owner.begin(async (tx) => {
    await tx`INSERT INTO service_lines(company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,
        list_price,price,discount,net,effective_discount_bps,limit_bps_applied,limit_source,name_en,name_ar,catalog_revision,
        rule_kind,rule_pct_bps,rule_fixed_amount,counts_toward_threshold,has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late)
      SELECT l.company_id,r.line,l.business_id,r.id,l.service_id,l.ordinal,l.input_index,l.status,l.revision,
        l.list_price,l.price,l.discount,l.net,l.effective_discount_bps,l.limit_bps_applied,l.limit_source,l.name_en,l.name_ar,l.catalog_revision,
        l.rule_kind,l.rule_pct_bps,l.rule_fixed_amount,l.counts_toward_threshold,l.has_performer_warning,l.recorded_by,l.recorded_by_membership_id,l.recorded_at,l.late
      FROM jsonb_to_recordset(${visits}::text::jsonb) r(id uuid,line uuid)
      CROSS JOIN service_lines l WHERE l.company_id=${f.company} AND l.id=${sourceLine}`;
    await tx`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,name_ar,not_clocked_in_warning,approved_leave_warning)
      SELECT p.company_id,gen_random_uuid(),p.business_id,r.line,p.employee_id,p.performer_ordinal,p.share_bps,p.name_en,p.name_ar,p.not_clocked_in_warning,p.approved_leave_warning
      FROM jsonb_to_recordset(${visits}::text::jsonb) r(line uuid)
      CROSS JOIN line_performers p WHERE p.company_id=${f.company} AND p.line_id=${sourceLine}`;
  });
  for (const table of ['service_session_recoveries', 'service_sessions', 'service_lines']) await f.h.owner.unsafe(`ANALYZE ${table}`);
});
afterAll(async () => { await f?.close(); });

it('uses the recovery unique index, the day index and a line index', async () => {
  const lookup = { scope: f.context(key), operation: 'record-service-session' as const, keyHash: recoveryKeyHash(key), at: AT, cursor: null };
  await f.db.withTenant(f.company, async (tx) => {
    const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sessionRecoveryStatement(lookup)}`);
    const plan = nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan);
    const indexes = plan.map((node) => node['Index Name']);
    expect(indexes).toContain('service_session_recoveries_attempt_key');
    expect(indexes).toContain('service_sessions_day_idx');
    expect(indexes.some((name) => name === 'service_lines_session_ordinal_key' || name === 'service_lines_recorder_idx' || name === 'service_lines_session_fk_idx')).toBe(true);
    for (const table of ['service_session_recoveries', 'service_sessions', 'service_lines']) {
      expect(plan.filter((node) => node['Relation Name'] === table).every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
    }
  }, { userId: f.userId });
});
