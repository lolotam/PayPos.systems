import type { Tx } from '@pospay/db';
import { parseMoney } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import type { SessionLine, SessionRecord, SessionRule } from '../domain/session-types.ts';

type Header = Omit<SessionRecord, 'customer' | 'lines' | 'occurred_at' | 'recorded_at'> & {
  customer_id: string; customer_name: string; customer_phone_masked: string; occurred_at: Date; recorded_at: Date };
type LineRow = {
  id: string; session_id: string; service_id: string; ordinal: number; input_index: number; status: 'ACTIVE' | 'CANCELLED'; revision: number;
  list_price: string; price: string; discount: string; net: string; effective_discount_bps: number; limit_bps_applied: number | null;
  limit_source: 'OWNER' | 'PERSON' | 'BUSINESS' | 'NOT_CONFIGURED'; name_en: string; name_ar: string | null; catalog_revision: number;
  rule_kind: SessionRule['kind']; rule_pct_bps: number | null; rule_fixed_amount: string | null;
  counts_toward_threshold: boolean; has_performer_warning: boolean; recorded_by: string; recorded_by_membership_id: string; recorded_at: Date; late: boolean;
};
type PerformerRow = { id: string; line_id: string; employee_id: string; name_en: string; name_ar: string | null; share_bps: number; not_clocked_in_warning: boolean; approved_leave_warning: boolean };

function storedRule(row: LineRow): SessionRule {
  switch (row.rule_kind) {
    case 'FOLLOW_PLAN': return { kind: 'FOLLOW_PLAN' };
    case 'ZERO': return { kind: 'ZERO' };
    case 'PCT': if (row.rule_pct_bps === null) throw new Error('Invalid stored rule'); return { kind: 'PCT', value: row.rule_pct_bps };
    case 'FIXED': if (row.rule_fixed_amount === null) throw new Error('Invalid stored rule'); return { kind: 'FIXED', value: parseMoney(row.rule_fixed_amount) };
    default: { const unreachable: never = row.rule_kind; throw new Error(`Invalid stored rule ${unreachable}`); }
  }
}
function storedLine(row: LineRow, performers: readonly PerformerRow[]): SessionLine {
  const members = performers.filter((p) => p.line_id === row.id);
  return { id: row.id, session_id: row.session_id, input_index: row.input_index, ordinal: row.ordinal, status: row.status, revision: row.revision,
    service: { id: row.service_id, name_en: row.name_en, name_ar: row.name_ar, price: parseMoney(row.list_price),
      rule: storedRule(row), counts: row.counts_toward_threshold, revision: row.catalog_revision },
    price: parseMoney(row.price), discount: parseMoney(row.discount), net: parseMoney(row.net), effective_discount_bps: row.effective_discount_bps,
    limit: row.limit_source === 'OWNER' ? { source: 'OWNER', bps: null } : { source: row.limit_source, bps: row.limit_bps_applied as number },
    recorded_by: row.recorded_by, recorded_by_membership_id: row.recorded_by_membership_id, recorded_at: new Date(row.recorded_at), late: row.late,
    has_performer_warning: row.has_performer_warning, explicit_unequal_shares: false, performer_ids: members.map((p) => p.id),
    performers: members.map((p) => ({ employee: { id: p.employee_id, name_en: p.name_en, name_ar: p.name_ar, user_id: null,
      eligible: true, clocked_in: !p.not_clocked_in_warning, approved_leave: p.approved_leave_warning }, share_bps: p.share_bps,
      not_clocked_in_warning: p.not_clocked_in_warning, approved_leave_warning: p.approved_leave_warning })) };
}

export async function loadSession(tx: Tx, companyId: string, businessId: string, branchId: string, sessionId: string): Promise<SessionRecord | null> {
  const [header] = await tx.execute<Header>(sql`SELECT id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
    recorded_by,recorded_by_membership_id,occurred_at,recorded_at,to_char(business_date,'YYYY-MM-DD') AS business_date,business_timezone,late
    FROM service_sessions WHERE company_id=${companyId} AND business_id=${businessId} AND branch_id=${branchId} AND id=${sessionId}`);
  if (header === undefined) return null;
  const lines = await tx.execute<LineRow>(sql`SELECT id,session_id,service_id,ordinal,input_index,status,revision,list_price::text,price::text,discount::text,net::text,
    effective_discount_bps,limit_bps_applied,limit_source,name_en,name_ar,catalog_revision,rule_kind,rule_pct_bps,rule_fixed_amount::text,
    counts_toward_threshold,has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late FROM service_lines
    WHERE company_id=${companyId} AND session_id=${sessionId} ORDER BY ordinal`);
  const performers = await tx.execute<PerformerRow>(sql`SELECT p.id,p.line_id,p.employee_id,p.name_en,p.name_ar,p.share_bps,p.not_clocked_in_warning,p.approved_leave_warning
    FROM line_performers p JOIN service_lines l ON l.company_id=p.company_id AND l.id=p.line_id
    WHERE p.company_id=${companyId} AND l.session_id=${sessionId} ORDER BY l.ordinal,p.performer_ordinal`);
  return { id: header.id, business_id: header.business_id, branch_id: header.branch_id,
    customer: { id: header.customer_id, name: header.customer_name, phone_masked: header.customer_phone_masked },
    recorded_by: header.recorded_by, recorded_by_membership_id: header.recorded_by_membership_id,
    occurred_at: new Date(header.occurred_at), recorded_at: new Date(header.recorded_at), business_date: header.business_date,
    business_timezone: header.business_timezone, late: header.late, lines: lines.map((l) => storedLine(l, performers)) };
}
