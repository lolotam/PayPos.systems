import { beforeAll, afterAll, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { ORDER_IDS } from '../../../../../../packages/db/test/orders-fixture.ts';
import { priceEditFixture, type PriceEditFixture } from './price-edit-notice.fixture.ts';
import {
  editSnapshotStatement,
  lineContextStatement,
  lineNoticeClaimStatement,
  lineNoticeMatchStatement,
} from '../persistence/service-line-edit-notice.repository.ts';

// The planner may serve these reads through service_lines_discount_proposal_key; it leads with the primary key columns (company_id, id).
let f: PriceEditFixture;
beforeAll(async () => {
  f = await priceEditFixture();
});
afterAll(async () => {
  await f?.close();
});

it(
  'matchesLine, the edit snapshot, the line context and the claim use tenant indexes',
  async () => {
    const prepared = await f.edit();
    await f.deliver(prepared.event);
    await plantRows(prepared.sessionId, prepared.lineId);
    const line = {
      companyId: prepared.companyId,
      businessId: prepared.businessId,
      branchId: prepared.branchId,
      sessionId: prepared.sessionId,
      lineId: prepared.lineId,
      revision: prepared.revision,
    };
    const match = JSON.stringify(await explain(lineNoticeMatchStatement(line)));
    const snapshot = JSON.stringify(
      await explain(editSnapshotStatement(line.companyId, line.lineId, line.revision)),
    );
    const context = JSON.stringify(await explain(lineContextStatement(line)));
    expect(match).toMatch(/service_lines_(company_id_id_pk|session_fk_idx|discount_proposal_key)/);
    expect(match).toMatch(/service_sessions_(company_id_id_pk|business_id_key)/);
    expect(snapshot).toContain('service_line_edits_line_revision_key');
    expect(context).toMatch(/service_lines_(company_id_id_pk|session_fk_idx|discount_proposal_key)/);
    for (const plan of [match, snapshot, context]) expect(plan).not.toContain('Seq Scan');
    const claim = JSON.stringify(
      await explain(
        lineNoticeClaimStatement(line, {
          id: f.ids.newId(),
          sourceEventId: prepared.event.id,
          decidedAt: f.at,
          recipientCount: 1,
        }),
      ),
    );
    expect(claim).toContain('service_line_edit_notices_line_revision_key');
    expect(claim).toContain('NOTHING');
    expect(await f.notices(prepared.lineId)).toHaveLength(1);
  },
  120_000,
);

async function plantRows(sessionId: string, lineId: string) {
  const company = f.tenant.company;
  await f.owner.begin(async (tx) => {
    await tx`INSERT INTO service_sessions SELECT (jsonb_populate_record(NULL::service_sessions,
      to_jsonb(s)||jsonb_build_object('id', gen_random_uuid()::text))).*
      FROM service_sessions s CROSS JOIN generate_series(1,2000)
      WHERE s.company_id=${company} AND s.id=${sessionId}`;
    await tx`INSERT INTO service_lines SELECT (jsonb_populate_record(NULL::service_lines,
      to_jsonb(l)||jsonb_build_object('id', gen_random_uuid()::text, 'session_id', s.id::text, 'ordinal', 1, 'revision', 2))).*
      FROM service_lines l
      JOIN service_sessions s ON s.company_id = l.company_id AND s.id <> ${sessionId} AND s.id <> ${ORDER_IDS.session}
      WHERE l.company_id=${company} AND l.id=${lineId}`;
    await tx`INSERT INTO line_performers SELECT (jsonb_populate_record(NULL::line_performers,
      to_jsonb(p)||jsonb_build_object('id', gen_random_uuid()::text, 'line_id', l.id::text))).*
      FROM line_performers p
      JOIN service_lines l ON l.company_id = p.company_id AND l.id <> ${lineId}
      WHERE p.company_id=${company} AND p.line_id=${lineId}
        AND l.session_id <> ${sessionId} AND l.session_id <> ${ORDER_IDS.session}`;
  });
  await f.owner`INSERT INTO service_line_edits SELECT (jsonb_populate_record(NULL::service_line_edits,
    to_jsonb(e)||jsonb_build_object('id', gen_random_uuid()::text, 'line_id', l.id::text))).*
    FROM service_line_edits e
    JOIN service_lines l ON l.company_id = e.company_id AND l.id <> e.line_id
    WHERE e.company_id=${company} AND e.line_id=${lineId} AND e.revision = 2
      AND l.session_id <> ${sessionId} AND l.session_id <> ${ORDER_IDS.session}`;
  await f.owner`ANALYZE service_sessions`;
  await f.owner`ANALYZE service_lines`;
  await f.owner`ANALYZE service_line_edits`;
  await f.owner`ANALYZE service_line_edit_notices`;
}
function explain(statement: SQL) {
  return f.db.withTenant(f.tenant.company, (tx) =>
    tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`),
  );
}
