import { beforeAll, afterAll, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { ORDER_IDS } from '../../../../../../packages/db/test/orders-fixture.ts';
import { lineCancelFixture, type LineCancelFixture } from './line-cancel-notice.fixture.ts';
import {
  cancellationStatement,
  lineCancelClaimStatement,
  lineCancelContextStatement,
  lineCancelMatchStatement,
} from '../persistence/service-line-cancel-notice.repository.ts';

// The planner may serve these reads through service_lines_discount_proposal_key, service_lines_id_session_key or service_sessions_branch_id_key; they lead with the primary key columns (company_id, id).
let f: LineCancelFixture;
beforeAll(async () => {
  f = await lineCancelFixture();
});
afterAll(async () => {
  await f?.close();
});

it('matchesLine, the cancellation row, the line context and the claim use tenant indexes', async () => {
  const prepared = await f.cancel();
  await f.deliver(prepared.event);
  await plantRows(prepared.sessionId);
  const line = {
    companyId: prepared.companyId,
    businessId: prepared.businessId,
    branchId: prepared.branchId,
    sessionId: prepared.sessionId,
    lineId: prepared.lineId,
    revision: prepared.revision,
    businessDate: prepared.businessDate,
  };
  const match = JSON.stringify(await explain(lineCancelMatchStatement(line)));
  const history = JSON.stringify(await explain(cancellationStatement(line.companyId, line.lineId)));
  const context = JSON.stringify(await explain(lineCancelContextStatement(line)));
  expect(match).toMatch(/service_lines_(company_id_id_pk|session_fk_idx|discount_proposal_key|id_session_key)/);
  expect(match).toMatch(/service_sessions_(company_id_id_pk|business_id_key|branch_id_key)/);
  expect(history).toContain('slc_line_uq');
  expect(context).toMatch(/service_lines_(company_id_id_pk|session_fk_idx|discount_proposal_key|id_session_key)/);
  for (const plan of [match, history, context]) expect(plan).not.toContain('Seq Scan');
  const claim = JSON.stringify(
    await explain(
      lineCancelClaimStatement(line, {
        id: f.ids.newId(),
        sourceEventId: prepared.event.id,
        decidedAt: f.at,
        recipientCount: 1,
      }),
    ),
  );
  expect(claim).toContain('service_line_cancel_notices_line_revision_key');
  expect(claim).toContain('NOTHING');
  expect(await f.notices(prepared.lineId)).toHaveLength(1);
}, 120_000);

async function plantRows(sessionId: string) {
  const company = f.tenant.company;
  await f.owner.begin(async (tx) => {
    await tx`INSERT INTO service_sessions SELECT (jsonb_populate_record(NULL::service_sessions,
      to_jsonb(s)||jsonb_build_object('id', gen_random_uuid()::text))).*
      FROM service_sessions s CROSS JOIN generate_series(1,2000)
      WHERE s.company_id=${company} AND s.id=${sessionId}`;
    await tx`INSERT INTO service_lines SELECT (jsonb_populate_record(NULL::service_lines,
      to_jsonb(l)||jsonb_build_object('id', gen_random_uuid()::text, 'session_id', s.id::text, 'ordinal', 1, 'input_index', 0, 'revision', 1, 'status', 'ACTIVE'))).*
      FROM service_lines l
      JOIN service_sessions s ON s.company_id = l.company_id AND s.id <> ${sessionId} AND s.id <> ${ORDER_IDS.session}
      WHERE l.company_id=${company} AND l.id=${ORDER_IDS.line}`;
    await tx`INSERT INTO line_performers SELECT (jsonb_populate_record(NULL::line_performers,
      to_jsonb(p)||jsonb_build_object('id', gen_random_uuid()::text, 'line_id', l.id::text))).*
      FROM line_performers p
      JOIN service_lines l ON l.company_id = p.company_id AND l.id <> ${ORDER_IDS.line}
      WHERE p.company_id=${company} AND p.line_id=${ORDER_IDS.line}
        AND l.session_id <> ${sessionId} AND l.session_id <> ${ORDER_IDS.session} AND l.status = 'ACTIVE'`;
    await tx`UPDATE service_lines SET status='CANCELLED', revision=revision+1
      WHERE company_id=${company} AND status='ACTIVE' AND revision=1 AND id <> ${ORDER_IDS.line}
        AND session_id <> ${sessionId} AND session_id <> ${ORDER_IDS.session}`;
    await tx`INSERT INTO service_line_cancellations(company_id,id,business_id,line_id,revision,previous_revision,
      previous_price,previous_discount,previous_net,cancelled_by,cancelled_by_membership_id,cancelled_at,reason,
      canceller_name_en)
      SELECT company_id, gen_random_uuid(), business_id, id, revision, revision - 1, price, discount, net,
        ${USER}, ${ORDER_IDS.membership}, clock_timestamp(), 'Cancelled', 'Synthetic canceller'
      FROM service_lines l
      WHERE company_id=${company} AND status='CANCELLED'
        AND NOT EXISTS (
          SELECT 1 FROM service_line_cancellations c WHERE c.company_id=l.company_id AND c.line_id=l.id
        )`;
  });
  await f.owner`ANALYZE service_sessions`;
  await f.owner`ANALYZE service_lines`;
  await f.owner`ANALYZE service_line_cancellations`;
  await f.owner`ANALYZE service_line_cancel_notices`;
}
function explain(statement: SQL) {
  return f.db.withTenant(f.tenant.company, (tx) =>
    tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`),
  );
}
