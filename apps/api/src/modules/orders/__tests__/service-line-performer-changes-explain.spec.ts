import type postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { applyChange, performer, type ChangeCtx, type Person } from '../../../../../../packages/db/test/service-line-performer-change.ts';
import { serviceLinePerformerChangesStatement } from '../queries/service-line-performer-changes.query.ts';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
let sessionId = '';
let lineId = '';
let ownerMembership = '';
interface PlanNode { 'Node Type': string; 'Relation Name'?: string; 'Index Name'?: string; Plans?: PlanNode[] }
const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];

beforeAll(async () => {
  f = await sessionFixture();
  const saved = await f.create.execute({ ...f.context(), input: f.body([f.line()]) });
  sessionId = saved.session.id;
  lineId = must(saved.session.lines[0]).id;
  const [membership] = await f.h.owner`SELECT id FROM memberships WHERE company_id=${f.company} AND user_id=${f.ownerId}`;
  ownerMembership = String(must(membership)['id']);
  await seedTargetChanges();
});
afterAll(async () => { await f?.close(); });

async function seedTargetChanges() {
  const [row] = await f.h.owner`SELECT service_id FROM service_lines WHERE company_id=${f.company} AND id=${lineId}`;
  const ctx: ChangeCtx = { company: f.company, business: f.business, branch: f.branch, userId: f.ownerId, membershipId: ownerMembership,
    sessionId, serviceId: String(must(row)['service_id']) };
  const first = await employeePerson(must(f.employees[0]));
  const second = await employeePerson(must(f.employees[1]));
  await change(ctx, { revision: 2, before: await livePeople(), after: [withShare(first, 1, 7000), withShare(second, 2, 3000)],
    reason: 'Split the colour and the rinse' });
  await change(ctx, { revision: 3, before: await livePeople(), after: [withShare(first, 1, 10000)],
    reason: 'Rana left the branch before the visit' });
}
async function change(ctx: ChangeCtx, planned: { revision: number; before: Person[]; after: Person[]; reason: string }) {
  await f.db.withTenant(f.company, (tx) => applyChange(tx, ctx, ids, {
    lineId, previous: planned.revision - 1, revision: planned.revision,
    before: planned.before, live: planned.after, after: planned.after, reason: planned.reason,
    warning: planned.after.some((person) => person.clock || person.leave),
  }), { userId: f.ownerId });
}
async function livePeople(): Promise<Person[]> {
  const rows = await f.h.owner`SELECT employee_id, performer_ordinal, share_bps, linked_user_id, linked_user_snapshotted,
    name_en, name_ar, not_clocked_in_warning, approved_leave_warning
    FROM line_performers WHERE company_id=${f.company} AND line_id=${lineId} ORDER BY performer_ordinal`;
  return rows.map((row) => performer(String(row['employee_id']), {
    ordinal: Number(row['performer_ordinal']), share: Number(row['share_bps']),
    userId: textOrNull(row['linked_user_id']), nameEn: String(row['name_en']), nameAr: textOrNull(row['name_ar']),
    snapshotted: row['linked_user_snapshotted'] === true, clock: row['not_clocked_in_warning'] === true,
    leave: row['approved_leave_warning'] === true,
  }));
}
async function employeePerson(employeeId: string): Promise<Person> {
  const [row] = await f.h.owner`SELECT name_en, name_ar, user_id FROM employees WHERE company_id=${f.company} AND id=${employeeId}`;
  const employee = must(row);
  return performer(employeeId, { userId: textOrNull(employee['user_id']), nameEn: String(employee['name_en']),
    nameAr: textOrNull(employee['name_ar']), snapshotted: true });
}
function withShare(person: Person, ordinal: number, share: number): Person {
  return performer(person.employeeId, { ordinal, share, userId: person.userId, nameEn: person.nameEn,
    nameAr: person.nameAr, snapshotted: person.snapshotted, clock: person.clock, leave: person.leave });
}
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// الحجم على أسطر كتير مش على سطر واحد: جداول التاريخ متريجرات، ف thousand revision على سطر واحد هتتكسر بالترiggers.
async function plant() {
  await f.h.owner.begin(async (tx) => { await copyVolume(tx, f.company); });
  await f.h.owner.begin(async (tx) => { await recordHistory(tx, f.company); });
  await f.h.owner`ANALYZE service_sessions`;
  await f.h.owner`ANALYZE service_lines`;
  await f.h.owner`ANALYZE line_performers`;
  await f.h.owner`ANALYZE service_line_performer_changes`;
  await f.h.owner`ANALYZE service_line_performer_change_rows`;
}
async function copyVolume(tx: postgres.TransactionSql, company: string) {
  await tx`INSERT INTO service_sessions SELECT (jsonb_populate_record(NULL::service_sessions,
    to_jsonb(s)||jsonb_build_object('id', gen_random_uuid()::text))).*
    FROM service_sessions s CROSS JOIN generate_series(1,2000)
    WHERE s.company_id=${company} AND s.id=${sessionId}`;
  await tx`INSERT INTO service_lines SELECT (jsonb_populate_record(NULL::service_lines,
    to_jsonb(l)||jsonb_build_object('id', gen_random_uuid()::text, 'session_id', s.id::text, 'ordinal', 1, 'input_index', 0, 'revision', 1, 'status', 'ACTIVE'))).*
    FROM service_lines l
    JOIN service_sessions s ON s.company_id = l.company_id AND s.id <> ${sessionId}
    WHERE l.company_id=${company} AND l.id=${lineId}`;
  await tx`INSERT INTO line_performers SELECT (jsonb_populate_record(NULL::line_performers,
    to_jsonb(p)||jsonb_build_object('id', gen_random_uuid()::text, 'line_id', l.id::text))).*
    FROM line_performers p
    JOIN service_lines l ON l.company_id = p.company_id AND l.id <> ${lineId}
    WHERE p.company_id=${company} AND p.line_id=${lineId}
      AND l.session_id <> ${sessionId} AND l.status = 'ACTIVE' AND l.revision = 1`;
}
async function recordHistory(tx: postgres.TransactionSql, company: string) {
  await tx`INSERT INTO service_line_performer_changes(company_id,id,business_id,line_id,revision,previous_revision,reason,changed_at,
    changed_by,changed_by_membership_id,changer_name_en,write_xid)
    SELECT l.company_id, gen_random_uuid(), l.business_id, l.id, 2, 1, 'Changed performers', clock_timestamp(),
      ${f.ownerId}, ${ownerMembership}, 'Synthetic changer', pg_current_xact_id()
    FROM service_lines l
    WHERE l.company_id=${company} AND l.status='ACTIVE' AND l.revision=1 AND l.id<>${lineId}
      AND l.session_id<>${sessionId}
      AND NOT EXISTS (
        SELECT 1 FROM service_line_performer_changes c
        WHERE c.company_id=l.company_id AND c.line_id=l.id)`;
  await insertSide(tx, company, 'BEFORE');
  await tx`UPDATE service_lines l SET revision=2
    FROM service_line_performer_changes c
    WHERE c.company_id=l.company_id AND c.business_id=l.business_id AND c.line_id=l.id
      AND c.write_xid=pg_current_xact_id() AND l.revision=1`;
  await insertSide(tx, company, 'AFTER');
}
async function insertSide(tx: postgres.TransactionSql, company: string, side: 'BEFORE' | 'AFTER') {
  await tx`INSERT INTO service_line_performer_change_rows(company_id,id,business_id,change_id,side,employee_id,performer_ordinal,share_bps,
    name_en,name_ar,linked_user_id,linked_user_snapshotted,not_clocked_in_warning,approved_leave_warning)
    SELECT c.company_id, gen_random_uuid(), c.business_id, c.id, ${side}, p.employee_id, p.performer_ordinal, p.share_bps,
      p.name_en, p.name_ar, p.linked_user_id, p.linked_user_snapshotted, p.not_clocked_in_warning, p.approved_leave_warning
    FROM service_line_performer_changes c
    JOIN line_performers p ON p.company_id=c.company_id AND p.business_id=c.business_id AND p.line_id=c.line_id
    WHERE c.company_id=${company} AND c.write_xid=pg_current_xact_id()`;
}

it('reads the history through slpc_history_idx and the sides through slpcr_change_fk_idx', async () => {
  await plant();
  const scope = { ...f.context(), userId: f.ownerId, sessionId, lineId };
  const cursor = Buffer.from(JSON.stringify({ v: 1, company: f.company, business: f.business, branch: f.branch,
    session: sessionId, line: lineId, revision: 3 })).toString('base64url');
  for (const query of [{ limit: 50 }, { limit: 50, cursor }]) {
    await f.db.withTenant(f.company, async (tx) => {
      const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
        sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${serviceLinePerformerChangesStatement(scope, query)}`);
      const plan = nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan);
      const headers = plan.filter((node) => node['Relation Name'] === 'service_line_performer_changes');
      expect(headers.length).toBeGreaterThan(0);
      expect(headers.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
      const sides = plan.filter((node) => node['Relation Name'] === 'service_line_performer_change_rows');
      expect(sides.length).toBeGreaterThan(0);
      expect(sides.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
      expect(plan.map((node) => node['Index Name'])).toContain('slpc_history_idx');
      expect(plan.map((node) => node['Index Name'])).toContain('slpcr_change_fk_idx');
    });
  }
}, 120_000);
