import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  insertLeaveReport,
  insertLeaveReportRow,
  type LeaveReportTenant,
} from '../../test/leave-history-report-fixture.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  await owner`INSERT INTO "user"(id, name, email, email_verified, created_at, updated_at)
    VALUES (${USER}, 'Cascade test user', 'cascade-spec@example.test', true, now(), now())
    ON CONFLICT DO NOTHING`;
  app = postgres(testDb.appUrl, { max: 2, onnotice: () => undefined });
});

afterAll(async () => {
  await app?.end();
  await owner?.end();
  await testDb?.drop();
});

async function asApp<T>(
  work: (tx: postgres.TransactionSql) => Promise<T>,
  tenant: LeaveReportTenant = TENANT.A,
) {
  return app.begin(async (tx) => {
    await tx`SELECT set_config('app.company_id', ${tenant.company}, true), set_config('app.user_id', ${USER}, true)`;
    return work(tx);
  });
}

it('as pospay_app under FORCE RLS, deleting a pending report cascades to its rows', async () => {
  const rId = await asApp((tx) => insertLeaveReport(tx));
  await asApp((tx) => insertLeaveReportRow(tx, rId, 1));
  await asApp((tx) => insertLeaveReportRow(tx, rId, 2));

  // pospay_app has no direct DELETE grant on rows, but DELETE on reports cascades successfully
  const deleted = await asApp((tx) =>
    tx`DELETE FROM leave_history_reports WHERE id = ${rId} RETURNING id`,
  );
  expect(deleted).toEqual([{ id: rId }]);

  const remainingRows = await asApp((tx) =>
    tx`SELECT seq FROM leave_history_report_rows WHERE report_id = ${rId}`,
  );
  expect(remainingRows).toHaveLength(0);
});

it('as pospay_app under FORCE RLS, deleting a ready report cascades to its rows', async () => {
  const rId = await asApp((tx) => insertLeaveReport(tx));
  await asApp((tx) => insertLeaveReportRow(tx, rId, 1));
  await asApp((tx) =>
    tx`UPDATE leave_history_reports
       SET status = 'ready', row_count = 1, computed_at = now()
       WHERE id = ${rId}`,
  );

  const deleted = await asApp((tx) =>
    tx`DELETE FROM leave_history_reports WHERE id = ${rId} RETURNING id`,
  );
  expect(deleted).toEqual([{ id: rId }]);

  const remainingRows = await asApp((tx) =>
    tx`SELECT seq FROM leave_history_report_rows WHERE report_id = ${rId}`,
  );
  expect(remainingRows).toHaveLength(0);
});

it('as pospay_app under FORCE RLS, deleting a failed report succeeds', async () => {
  const rId = await asApp((tx) => insertLeaveReport(tx));
  await asApp((tx) =>
    tx`UPDATE leave_history_reports
       SET status = 'failed', error_code = 'LEAVE_HISTORY_REPORT_FAILED', row_count = 0
       WHERE id = ${rId}`,
  );

  const deleted = await asApp((tx) =>
    tx`DELETE FROM leave_history_reports WHERE id = ${rId} RETURNING id`,
  );
  expect(deleted).toEqual([{ id: rId }]);
});

it('deleting a report in Company A leaves Company B rows completely untouched', async () => {
  const rIdA = await asApp((tx) => insertLeaveReport(tx, {}, TENANT.A), TENANT.A);
  await asApp((tx) => insertLeaveReportRow(tx, rIdA, 1, {}, TENANT.A), TENANT.A);

  const rIdB = await asApp((tx) => insertLeaveReport(tx, {}, TENANT.B), TENANT.B);
  await asApp((tx) => insertLeaveReportRow(tx, rIdB, 1, {}, TENANT.B), TENANT.B);

  // Company A deletes its report
  await asApp((tx) => tx`DELETE FROM leave_history_reports WHERE id = ${rIdA}`, TENANT.A);

  // Company B's report and rows are untouched
  const bReports = await asApp(
    (tx) => tx`SELECT id FROM leave_history_reports WHERE id = ${rIdB}`,
    TENANT.B,
  );
  expect(bReports).toEqual([{ id: rIdB }]);

  const bRows = await asApp(
    (tx) => tx`SELECT seq FROM leave_history_report_rows WHERE report_id = ${rIdB}`,
    TENANT.B,
  );
  expect(bRows).toEqual([{ seq: 1 }]);
});

it('expiry cleanup index exists and is used without Seq Scan', async () => {
  const [indexRow] = await owner<{ indexdef: string }[]>`
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'leave_history_reports' AND indexname = 'leave_history_reports_expiry_idx'`;
  expect(indexRow?.indexdef).toBeDefined();
  expect(indexRow?.indexdef).toContain('(company_id, expires_at)');

  // Seed 300 reports across various expiration intervals
  const reportsToInsert = Array.from({ length: 300 }, (_, i) => ({
    company_id: TENANT.A.company,
    id: randomUUID(),
    business_id: TENANT.A.business,
    created_by: USER,
    query: owner.json({ i }),
    fingerprint: '4'.repeat(64),
    scope: owner.json({ i }),
    as_of: new Date('2026-11-12T10:00:00Z'),
    deadline_at: new Date('2026-11-12T10:05:00Z'),
    status: 'pending',
    error_code: null,
    row_count: 0,
    computed_at: null,
    expires_at: new Date(Date.now() + (i - 150) * 60_000),
  }));

  await owner`INSERT INTO leave_history_reports ${owner(reportsToInsert)}`;

  const plan = await asApp(async (tx) => {
    await tx`SET enable_seqscan = off`;
    return tx<{ 'QUERY PLAN': string }[]>`
      EXPLAIN SELECT id FROM leave_history_reports
      WHERE company_id = ${TENANT.A.company} AND expires_at <= now()`;
  }, TENANT.A);

  const planText = plan.map((p) => p['QUERY PLAN']).join('\n');
  expect(planText).not.toContain('Seq Scan on leave_history_reports');
  expect(planText).toContain('Index');
});
