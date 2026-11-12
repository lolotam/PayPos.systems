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

let idA: string;
let idB: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO "user"(id, name, email, email_verified, created_at, updated_at)
    VALUES (${USER}, 'Report owner user', 'reports-rls@example.test', true, now(), now())
    ON CONFLICT DO NOTHING`;
  app = postgres(testDb.appUrl, { max: 2, onnotice: () => undefined });

  await asApp(async (tx) => {
    idA = await insertLeaveReport(tx, {}, TENANT.A);
    await insertLeaveReportRow(tx, idA, 1, {}, TENANT.A);
  }, TENANT.A);

  await asApp(async (tx) => {
    idB = await insertLeaveReport(tx, {}, TENANT.B);
    await insertLeaveReportRow(tx, idB, 1, {}, TENANT.B);
  }, TENANT.B);
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

it('cross-tenant read on leave_history_reports returns 0 rows', async () => {
  const rowsA = await asApp(
    (tx) => tx`SELECT id FROM leave_history_reports WHERE id = ${idA}`,
    TENANT.A,
  );
  expect(rowsA).toEqual([{ id: idA }]);

  const hiddenFromA = await asApp(
    (tx) => tx`SELECT id FROM leave_history_reports WHERE id = ${idB}`,
    TENANT.A,
  );
  expect(hiddenFromA).toHaveLength(0);

  const crossCompanyFromA = await asApp(
    (tx) => tx`SELECT id FROM leave_history_reports WHERE company_id = ${TENANT.B.company}`,
    TENANT.A,
  );
  expect(crossCompanyFromA).toHaveLength(0);

  const rowsB = await asApp(
    (tx) => tx`SELECT id FROM leave_history_reports WHERE id = ${idB}`,
    TENANT.B,
  );
  expect(rowsB).toEqual([{ id: idB }]);

  const hiddenFromB = await asApp(
    (tx) => tx`SELECT id FROM leave_history_reports WHERE id = ${idA}`,
    TENANT.B,
  );
  expect(hiddenFromB).toHaveLength(0);

  const unauthedRows = await app`SELECT id FROM leave_history_reports`;
  expect(unauthedRows).toHaveLength(0);
});

it('cross-tenant insert on leave_history_reports is refused by RLS WITH CHECK', async () => {
  await expect(
    asApp(
      (tx) =>
        insertLeaveReport(
          tx,
          {
            company_id: TENANT.B.company,
            business_id: TENANT.A.business,
          },
          TENANT.A,
        ),
      TENANT.A,
    ),
  ).rejects.toMatchObject({ code: '42501' });
});

it('cross-tenant update on leave_history_reports affects 0 rows', async () => {
  const touched = await asApp(
    (tx) =>
      tx`UPDATE leave_history_reports
         SET status = 'failed', error_code = 'LEAVE_HISTORY_REPORT_FAILED'
         WHERE company_id = ${TENANT.B.company} AND id = ${idB}
         RETURNING id`,
    TENANT.A,
  );
  expect(touched).toHaveLength(0);

  await expect(
    asApp(
      (tx) =>
        tx`UPDATE leave_history_reports
           SET company_id = ${TENANT.B.company}
           WHERE id = ${idA}`,
      TENANT.A,
    ),
  ).rejects.toMatchObject({ code: '42501' });
});

it('cross-tenant delete on leave_history_reports affects 0 rows', async () => {
  const touchedCross = await asApp(
    (tx) =>
      tx`DELETE FROM leave_history_reports
         WHERE company_id = ${TENANT.B.company} AND id = ${idB}
         RETURNING id`,
    TENANT.A,
  );
  expect(touchedCross).toHaveLength(0);

  const touchedById = await asApp(
    (tx) =>
      tx`DELETE FROM leave_history_reports
         WHERE id = ${idB}
         RETURNING id`,
    TENANT.A,
  );
  expect(touchedById).toHaveLength(0);
});

it('cross-tenant read on leave_history_report_rows returns 0 rows', async () => {
  const rowsA = await asApp(
    (tx) => tx`SELECT seq FROM leave_history_report_rows WHERE report_id = ${idA}`,
    TENANT.A,
  );
  expect(rowsA).toEqual([{ seq: 1 }]);

  const hiddenFromA = await asApp(
    (tx) => tx`SELECT seq FROM leave_history_report_rows WHERE report_id = ${idB}`,
    TENANT.A,
  );
  expect(hiddenFromA).toHaveLength(0);

  const crossCompanyFromA = await asApp(
    (tx) => tx`SELECT seq FROM leave_history_report_rows WHERE company_id = ${TENANT.B.company}`,
    TENANT.A,
  );
  expect(crossCompanyFromA).toHaveLength(0);

  const rowsB = await asApp(
    (tx) => tx`SELECT seq FROM leave_history_report_rows WHERE report_id = ${idB}`,
    TENANT.B,
  );
  expect(rowsB).toEqual([{ seq: 1 }]);

  const hiddenFromB = await asApp(
    (tx) => tx`SELECT seq FROM leave_history_report_rows WHERE report_id = ${idA}`,
    TENANT.B,
  );
  expect(hiddenFromB).toHaveLength(0);

  const unauthedRows = await app`SELECT seq FROM leave_history_report_rows`;
  expect(unauthedRows).toHaveLength(0);
});

it('cross-tenant insert on leave_history_report_rows is refused by RLS WITH CHECK', async () => {
  await expect(
    asApp(
      (tx) =>
        insertLeaveReportRow(
          tx,
          idB,
          2,
          {
            company_id: TENANT.B.company,
          },
          TENANT.A,
        ),
      TENANT.A,
    ),
  ).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('LEAVE_HISTORY_REPORT_NOT_PENDING') });
});
