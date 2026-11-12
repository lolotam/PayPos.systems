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

interface ForeignKeyRow {
  name: string;
  parent: string;
  columns: string[];
}

interface IndexRow {
  name: string;
  columns: string[];
}

const EXPECTED_REPORT_FKS = [
  { name: 'leave_history_reports_business_fk', columns: ['company_id', 'business_id'], parent: 'businesses' },
  { name: 'leave_history_reports_company_id_companies_id_fk', columns: ['company_id'], parent: 'companies' },
  { name: 'leave_history_reports_creator_fk', columns: ['created_by'], parent: '"user"' },
];

const EXPECTED_ROW_FKS = [
  { name: 'leave_history_report_rows_company_id_companies_id_fk', columns: ['company_id'], parent: 'companies' },
  { name: 'leave_history_report_rows_report_fk', columns: ['company_id', 'report_id'], parent: 'leave_history_reports' },
];

let testDb: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;

let reportAId: string;
let reportBId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO "user"(id, name, email, email_verified, created_at, updated_at)
    VALUES (${USER}, 'FK test user', 'fk-spec@example.test', true, now(), now())
    ON CONFLICT DO NOTHING`;
  app = postgres(testDb.appUrl, { max: 2, onnotice: () => undefined });

  await asApp(async (tx) => {
    reportAId = await insertLeaveReport(tx, {}, TENANT.A);
  }, TENANT.A);

  await asApp(async (tx) => {
    reportBId = await insertLeaveReport(tx, {}, TENANT.B);
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

const foreignKeys = (table: string) =>
  owner<ForeignKeyRow[]>`
    SELECT c.conname AS name, c.confrelid::regclass::text AS parent,
      ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
            ORDER BY k.ord) AS columns
    FROM pg_constraint c
    WHERE c.contype = 'f' AND c.conrelid = ${table}::regclass
    ORDER BY c.conname`;

const indexes = (table: string) =>
  owner<IndexRow[]>`
    SELECT i.indexrelid::regclass::text AS name,
      ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
            ORDER BY k.ord) AS columns
    FROM pg_index i
    WHERE i.indrelid = ${table}::regclass
    ORDER BY name`;

it('declared foreign keys match schema expectations for leave_history_reports and rows', async () => {
  const reportFks = await foreignKeys('leave_history_reports');
  expect(reportFks).toEqual(EXPECTED_REPORT_FKS);

  const rowFks = await foreignKeys('leave_history_report_rows');
  expect(rowFks).toEqual(EXPECTED_ROW_FKS);
});

it('declared indexes exist for FK columns, dedupe and expiry', async () => {
  const reportIdxs = await indexes('leave_history_reports');
  const indexNames = reportIdxs.map((i) => i.name);
  expect(indexNames).toContain('leave_history_reports_business_fk_idx');
  expect(indexNames).toContain('leave_history_reports_creator_fk_idx');
  expect(indexNames).toContain('leave_history_reports_dedupe_idx');
  expect(indexNames).toContain('leave_history_reports_expiry_idx');
});

it('composite FK on reports refuses business_id from another company', async () => {
  await expect(
    owner`INSERT INTO leave_history_reports (
      company_id, id, business_id, created_by, query, fingerprint, scope, as_of, deadline_at, expires_at
    ) VALUES (
      ${TENANT.A.company}, ${randomUUID()}, ${TENANT.B.business}, ${USER},
      '{}'::jsonb, ${'2'.repeat(64)}, '{}'::jsonb, now(), now() + interval '5 min', now() + interval '1 hour'
    )`,
  ).rejects.toMatchObject({
    code: '23503',
    constraint_name: 'leave_history_reports_business_fk',
  });
});

it('FK on reports refuses unknown creator user', async () => {
  await expect(
    owner`INSERT INTO leave_history_reports (
      company_id, id, business_id, created_by, query, fingerprint, scope, as_of, deadline_at, expires_at
    ) VALUES (
      ${TENANT.A.company}, ${randomUUID()}, ${TENANT.A.business}, ${randomUUID()},
      '{}'::jsonb, ${'3'.repeat(64)}, '{}'::jsonb, now(), now() + interval '5 min', now() + interval '1 hour'
    )`,
  ).rejects.toMatchObject({
    code: '23503',
    constraint_name: 'leave_history_reports_creator_fk',
  });
});

it('composite FK on rows refuses row naming another company report', async () => {
  await expect(
    asApp(
      (tx) =>
        insertLeaveReportRow(tx, reportBId, 1, {}, TENANT.A),
      TENANT.A,
    ),
  ).rejects.toMatchObject({
    code: expect.stringMatching(/23514|23503/),
  });
});

it('composite FK on rows refuses row naming a missing report', async () => {
  await expect(
    asApp(
      (tx) =>
        insertLeaveReportRow(tx, randomUUID(), 1, {}, TENANT.A),
      TENANT.A,
    ),
  ).rejects.toMatchObject({
    code: expect.stringMatching(/23514|23503/),
  });
});

it('PK uniqueness enforces (company_id, id) on leave_history_reports', async () => {
  await expect(
    asApp(
      (tx) =>
        insertLeaveReport(tx, { id: reportAId }, TENANT.A),
      TENANT.A,
    ),
  ).rejects.toMatchObject({
    code: '23505',
    constraint_name: 'leave_history_reports_pkey',
  });
});

it('PK uniqueness enforces (company_id, report_id, seq) on leave_history_report_rows', async () => {
  await asApp((tx) => insertLeaveReportRow(tx, reportAId, 1, {}, TENANT.A), TENANT.A);

  await expect(
    asApp((tx) => insertLeaveReportRow(tx, reportAId, 1, {}, TENANT.A), TENANT.A),
  ).rejects.toMatchObject({
    code: '23505',
    constraint_name: 'leave_history_report_rows_pkey',
  });
});
