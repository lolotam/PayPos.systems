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
let auth: postgres.Sql;
let dispatcher: postgres.Sql;

let reportId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO "user"(id, name, email, email_verified, created_at, updated_at)
    VALUES (${USER}, 'Grants test user', 'grants-spec@example.test', true, now(), now())
    ON CONFLICT DO NOTHING`;
  app = postgres(testDb.appUrl, { max: 2, onnotice: () => undefined });
  auth = postgres(testDb.authUrl, { max: 1, onnotice: () => undefined });
  dispatcher = postgres(testDb.dispatcherUrl, { max: 1, onnotice: () => undefined });

  await asApp(async (tx) => {
    reportId = await insertLeaveReport(tx);
    await insertLeaveReportRow(tx, reportId, 1);
  });
});

afterAll(async () => {
  await dispatcher?.end();
  await auth?.end();
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

it.each(['query', 'scope', 'expires_at', 'fingerprint', 'business_id', 'created_by'])(
  'pospay_app UPDATE on column %s is refused by missing column grant',
  async (column) => {
    await expect(
      asApp((tx) => {
        if (column === 'query') {
          return tx`UPDATE leave_history_reports SET query = ${tx.json({})} WHERE id = ${reportId}`;
        }
        if (column === 'scope') {
          return tx`UPDATE leave_history_reports SET scope = ${tx.json({})} WHERE id = ${reportId}`;
        }
        if (column === 'expires_at') {
          return tx`UPDATE leave_history_reports SET expires_at = now() WHERE id = ${reportId}`;
        }
        if (column === 'fingerprint') {
          return tx`UPDATE leave_history_reports SET fingerprint = ${'f'.repeat(64)} WHERE id = ${reportId}`;
        }
        if (column === 'business_id') {
          return tx`UPDATE leave_history_reports SET business_id = ${randomUUID()} WHERE id = ${reportId}`;
        }
        return tx`UPDATE leave_history_reports SET created_by = ${randomUUID()} WHERE id = ${reportId}`;
      }),
    ).rejects.toMatchObject({ code: '42501' });
  },
);

it('pospay_app UPDATE on leave_history_report_rows is refused with privilege error', async () => {
  await expect(
    asApp((tx) =>
      tx`UPDATE leave_history_report_rows
         SET record = ${tx.json({ updated: true })}
         WHERE report_id = ${reportId} AND seq = 1`,
    ),
  ).rejects.toMatchObject({ code: '42501' });
});

it('pospay_app direct DELETE on leave_history_report_rows is refused with privilege error', async () => {
  await expect(
    asApp((tx) =>
      tx`DELETE FROM leave_history_report_rows
         WHERE report_id = ${reportId} AND seq = 1`,
    ),
  ).rejects.toMatchObject({ code: '42501' });
});

it('pospay_auth has no privilege on leave_history_reports or leave_history_report_rows', async () => {
  await expect(auth`SELECT id FROM leave_history_reports`).rejects.toMatchObject({ code: '42501' });
  await expect(auth`SELECT seq FROM leave_history_report_rows`).rejects.toMatchObject({
    code: '42501',
  });
  await expect(
    auth`INSERT INTO leave_history_reports (company_id, id, business_id, created_by, query, fingerprint, scope, as_of, deadline_at, expires_at)
         VALUES (${TENANT.A.company}, ${randomUUID()}, ${TENANT.A.business}, ${USER}, '{}'::jsonb, ${'0'.repeat(64)}, '{}'::jsonb, now(), now() + interval '5 min', now() + interval '1 hour')`,
  ).rejects.toMatchObject({ code: '42501' });
});

it('pospay_dispatcher has no privilege on leave_history_reports or leave_history_report_rows', async () => {
  await expect(dispatcher`SELECT id FROM leave_history_reports`).rejects.toMatchObject({
    code: '42501',
  });
  await expect(dispatcher`SELECT seq FROM leave_history_report_rows`).rejects.toMatchObject({
    code: '42501',
  });
});
