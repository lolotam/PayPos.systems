import type postgres from 'postgres';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { ORDER_IDS } from '../../../../../../packages/db/test/orders-fixture.ts';
import {
  performersChangeFixture,
  type PerformersChangeFixture,
} from './performers-change-notice.fixture.ts';
import {
  performersChangeClaimStatement,
  performersChangeContextStatement,
  performersChangeHeaderStatement,
  performersChangeMatchStatement,
  performersChangeRowsStatement,
} from '../persistence/service-line-performer-notice.repository.ts';

let f: PerformersChangeFixture;
beforeAll(async () => {
  f = await performersChangeFixture();
});
afterAll(async () => {
  await f?.close();
});

it('matchesLine, the change header, its rows, the line context and the claim use tenant indexes', async () => {
  const prepared = await f.change();
  await f.deliver(prepared.event);
  await plantRows();
  const line = {
    companyId: prepared.companyId,
    businessId: prepared.businessId,
    branchId: prepared.branchId,
    sessionId: prepared.sessionId,
    lineId: prepared.lineId,
    revision: prepared.revision,
    businessDate: prepared.businessDate,
    lineNet: prepared.net,
    performers: [],
    previousRevision: prepared.revision - 1,
    previousPerformers: [],
  };
  const match = JSON.stringify(await explain(performersChangeMatchStatement(line)));
  const header = JSON.stringify(
    await explain(performersChangeHeaderStatement(line.companyId, line.lineId, line.revision)),
  );
  const rows = JSON.stringify(
    await explain(performersChangeRowsStatement(line.companyId, line.lineId, line.revision)),
  );
  const context = JSON.stringify(await explain(performersChangeContextStatement(line)));
  expect(match).toMatch(/service_lines_(company_id_id_pk|session_fk_idx|business_id_key)/);
  expect(match).toMatch(/service_sessions_(company_id_id_pk|business_id_key)/);
  expect(header).toMatch(/slpc_line_(revision|xid)_uq/);
  expect(rows).toMatch(/slpc_line_(revision|xid)_uq/);
  expect(rows).toMatch(/slpcr_(change_fk_idx|ordinal_uq)/);
  expect(context).toMatch(/service_lines_(company_id_id_pk|session_fk_idx|business_id_key)/);
  for (const plan of [match, header, rows, context]) expect(plan).not.toContain('Seq Scan');
  const claim = JSON.stringify(
    await explain(
      performersChangeClaimStatement(line, {
        id: f.ids.newId(),
        sourceEventId: prepared.event.id,
        decidedAt: f.at,
        recipientCount: 1,
      }),
    ),
  );
  expect(claim).toContain('service_line_performer_notices_line_revision_key');
  expect(claim).toContain('NOTHING');
  expect(await f.notices(prepared.lineId)).toHaveLength(1);
}, 120_000);

async function plantRows() {
  const company = f.tenant.company;
  await f.owner.begin(async (tx) => {
    await copyVolume(tx, company);
  });
  // حارس التاريخ يرجع مبكراً بلا app_company_id، والفحص المؤجل يرفض write_xid من غير معاملة الإدراج.
  await f.owner.begin(async (tx) => {
    await recordHistory(tx, company);
  });
  await analyzePlant();
}
async function copyVolume(tx: postgres.TransactionSql, company: string) {
  await tx`INSERT INTO service_sessions SELECT (jsonb_populate_record(NULL::service_sessions,
    to_jsonb(s)||jsonb_build_object('id', gen_random_uuid()::text))).*
    FROM service_sessions s CROSS JOIN generate_series(1,2000)
    WHERE s.company_id=${company} AND s.id=${ORDER_IDS.session}`;
  await tx`INSERT INTO service_lines SELECT (jsonb_populate_record(NULL::service_lines,
    to_jsonb(l)||jsonb_build_object('id', gen_random_uuid()::text, 'session_id', s.id::text, 'ordinal', 1, 'input_index', 0, 'revision', 1, 'status', 'ACTIVE'))).*
    FROM service_lines l
    JOIN service_sessions s ON s.company_id = l.company_id AND s.id <> ${ORDER_IDS.session}
    WHERE l.company_id=${company} AND l.id=${ORDER_IDS.line}`;
  await tx`INSERT INTO line_performers SELECT (jsonb_populate_record(NULL::line_performers,
    to_jsonb(p)||jsonb_build_object('id', gen_random_uuid()::text, 'line_id', l.id::text))).*
    FROM line_performers p
    JOIN service_lines l ON l.company_id = p.company_id AND l.id <> ${ORDER_IDS.line}
    WHERE p.company_id=${company} AND p.line_id=${ORDER_IDS.line}
      AND l.session_id <> ${ORDER_IDS.session} AND l.status = 'ACTIVE' AND l.revision = 1`;
}
async function recordHistory(tx: postgres.TransactionSql, company: string) {
  await tx`INSERT INTO service_line_performer_changes(company_id,id,business_id,line_id,revision,previous_revision,reason,changed_at,
    changed_by,changed_by_membership_id,changer_name_en,write_xid)
    SELECT l.company_id, gen_random_uuid(), l.business_id, l.id, 2, 1, 'Changed performers', clock_timestamp(),
      ${USER}, ${ORDER_IDS.membership}, 'Synthetic changer', pg_current_xact_id()
    FROM service_lines l
    WHERE l.company_id=${company} AND l.status='ACTIVE' AND l.revision=1 AND l.id<>${ORDER_IDS.line}
      AND l.session_id<>${ORDER_IDS.session}
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
async function analyzePlant() {
  await f.owner`ANALYZE service_sessions`;
  await f.owner`ANALYZE service_lines`;
  await f.owner`ANALYZE line_performers`;
  await f.owner`ANALYZE service_line_performer_changes`;
  await f.owner`ANALYZE service_line_performer_change_rows`;
  await f.owner`ANALYZE service_line_performer_notices`;
}
function explain(statement: SQL) {
  return f.db.withTenant(f.tenant.company, (tx) =>
    tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`),
  );
}
