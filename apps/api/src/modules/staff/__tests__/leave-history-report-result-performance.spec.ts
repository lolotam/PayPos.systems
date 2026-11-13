import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { encodeCursor } from '../../../shared/persistence/name-options-cursor.ts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { leaveHistoryReportPageStatement } from '../queries/leave-history-report-page.sql.ts';
import { seedHistoryVolume } from './leave-history-performance.fixture.ts';
import { leaveFixture, leaveIds, type LeaveFixture } from './leave-history.fixture.ts';
import { takeTestEmployeeNumber } from '../../../../test/test-employee-number.ts';

let f: LeaveFixture;
let reportId: string;
let invisibleReportId: string;
let lateCursor: string;

const access = createLeaveReadAccess({ now: () => new Date('2026-11-07T10:00:00.000Z') });

function assertNoSeqScanOnReportRows(plan: unknown): void {
  const node = plan as { 'Node Type'?: string; 'Relation Name'?: string; Plans?: unknown[] };
  if (node['Node Type'] === 'Seq Scan') {
    expect(node['Relation Name']).not.toBe('leave_history_report_rows');
  }
  for (const child of node.Plans ?? []) {
    assertNoSeqScanOnReportRows(child);
  }
}

function reportScope(f: LeaveFixture) {
  return {
    branches: [f.branch, f.secondBranch],
    attendanceBranches: [f.branch],
    cancelBranches: [f.branch],
    decideBranches: [f.branch],
    revokeBranches: [f.branch],
    createBranches: [f.branch],
    eligibilityBranchIds: [f.branch],
  };
}

function reportQuery() {
  return {
    from: '2026-01-01',
    to: '2026-10-31',
    'types[]': ['ANNUAL'],
    'statuses[]': ['APPROVED'],
  };
}

// The report every employee of the fixture can read: 25,000 rows, then the ready transition.
async function seedVisibleReport(f: LeaveFixture, reportId: string, scope: object, query: object) {
  await f.h.owner`INSERT INTO leave_history_reports
    (company_id, id, business_id, created_by, query, fingerprint, scope, as_of, deadline_at, status, row_count, expires_at)
    VALUES (${f.company}, ${reportId}, ${f.business}, ${f.userId}, ${JSON.stringify(query)}::jsonb,
    ${'2'.repeat(64)}, ${JSON.stringify(scope)}::jsonb, now(), now() + interval '10 minutes',
    'pending', 0, now() + interval '1 hour')`;

  await f.h.owner`INSERT INTO leave_history_report_rows (company_id, report_id, seq, employee_id, record)
    SELECT
      ${f.company},
      ${reportId},
      s,
      ${f.employee.id}::uuid,
      jsonb_build_object(
        'row_type', 'UNEXCUSED_ABSENCE',
        'id', gen_random_uuid(),
        'employee_id', ${f.employee.id}::uuid,
        'employee_name_en', 'Synthetic employee',
        'employee_name_ar', null,
        'employee_number', s,
        'working_date', '2026-10-01',
        'branch_id', ${f.branch}::uuid,
        'shifts', jsonb_build_array(jsonb_build_object('start', '09:00', 'end', '17:00')),
        'status', 'ABSENT'
      )
    FROM generate_series(1, 25000) AS s`;

  await f.h.owner`UPDATE leave_history_reports
    SET status = 'ready', computed_at = now(), row_count = 25000
    WHERE company_id = ${f.company} AND id = ${reportId}`;
}

// Report where all but 5 employees in first window are invisible
async function seedInvisibleReport(f: LeaveFixture, reportId: string, scope: object, query: object) {
  const deletedEmpId = leaveIds.newId();
  await f.h.owner`INSERT INTO employees (company_id, id, business_id, primary_branch_id, name_en, name_en_key, role_code, hire_date, employee_number, deleted_at)
    VALUES (${f.company}, ${deletedEmpId}, ${f.business}, ${f.branch}, 'Deleted Employee', 'deleted employee', 'staff', '2025-01-01', ${takeTestEmployeeNumber(f.company)}, now())`;

  await f.h.owner`INSERT INTO leave_history_reports
    (company_id, id, business_id, created_by, query, fingerprint, scope, as_of, deadline_at, status, row_count, expires_at)
    VALUES (${f.company}, ${reportId}, ${f.business}, ${f.userId}, ${JSON.stringify(query)}::jsonb,
    ${'3'.repeat(64)}, ${JSON.stringify(scope)}::jsonb, now(), now() + interval '10 minutes',
    'pending', 0, now() + interval '1 hour')`;

  await f.h.owner`INSERT INTO leave_history_report_rows (company_id, report_id, seq, employee_id, record)
    SELECT
      ${f.company},
      ${reportId},
      s,
      CASE WHEN s > 995 THEN ${f.employee.id}::uuid ELSE ${deletedEmpId}::uuid END,
      jsonb_build_object(
        'row_type', 'UNEXCUSED_ABSENCE',
        'id', gen_random_uuid(),
        'employee_id', (CASE WHEN s > 995 THEN ${f.employee.id}::uuid ELSE ${deletedEmpId}::uuid END),
        'employee_name_en', 'Employee',
        'employee_name_ar', null,
        'employee_number', s,
        'working_date', '2026-10-01',
        'branch_id', ${f.branch}::uuid,
        'shifts', jsonb_build_array(jsonb_build_object('start', '09:00', 'end', '17:00')),
        'status', 'ABSENT'
      )
    FROM generate_series(1, 25000) AS s`;

  await f.h.owner`UPDATE leave_history_reports
    SET status = 'ready', computed_at = now(), row_count = 25000
    WHERE company_id = ${f.company} AND id = ${reportId}`;
}

beforeAll(async () => {
  f = await leaveFixture({ hireDate: '2025-01-01' });
  await seedHistoryVolume(f);

  reportId = leaveIds.newId();
  const scope = reportScope(f);
  const query = reportQuery();

  await seedVisibleReport(f, reportId, scope, query);

  lateCursor = encodeCursor({ report_id: reportId, seq: 24000 });

  invisibleReportId = leaveIds.newId();
  await seedInvisibleReport(f, invisibleReportId, scope, query);

  await f.h.owner.unsafe('ANALYZE leave_history_reports');
  await f.h.owner.unsafe('ANALYZE leave_history_report_rows');
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('asserts EXPLAIN ANALYZE has no sequential scan on rows and execution time under 200 ms', async () => {
  const result = await f.db.withTenant(f.company, async (tx) => {
    const context = { companyId: f.company, businessId: f.business, userId: f.userId, own: false };
    const scope = await access.check(tx, context);
    if (!scope) throw new Error('Scope missing');
    const statement = leaveHistoryReportPageStatement(context, scope, {
      reportId,
      after: 0,
      limit: 100,
    });
    return tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`);
  });

  const raw = result[0]?.['QUERY PLAN'] as [{ Plan: unknown; 'Execution Time': number }];
  expect(raw[0]['Execution Time']).toBeLessThanOrEqual(200);
  assertNoSeqScanOnReportRows(raw[0].Plan);
});

it('keeps HTTP p95 under 200 ms across 30 reads for first page of 25,000-row report', async () => {
  const times: number[] = [];
  const url = `/v1/businesses/${f.business}/leave-history/reports/${reportId}?limit=100`;

  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    const res = await f.h.app.inject({
      method: 'GET',
      url,
      headers: { cookie: f.cookie, 'x-company-id': f.company },
    });
    times.push(performance.now() - start);
    expect(res.statusCode).toBe(200);
  }

  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
  expect(p95).toBeLessThan(200);
});

it('keeps HTTP p95 under 200 ms across 30 reads for late page near 24,000', async () => {
  const times: number[] = [];
  const url = `/v1/businesses/${f.business}/leave-history/reports/${reportId}?limit=100&cursor=${lateCursor}`;

  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    const res = await f.h.app.inject({
      method: 'GET',
      url,
      headers: { cookie: f.cookie, 'x-company-id': f.company },
    });
    times.push(performance.now() - start);
    expect(res.statusCode).toBe(200);
  }

  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
  expect(p95).toBeLessThan(200);
});

it('keeps HTTP p95 under 200 ms across 30 reads when most employees are invisible', async () => {
  const times: number[] = [];
  const url = `/v1/businesses/${f.business}/leave-history/reports/${invisibleReportId}?limit=100`;

  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    const res = await f.h.app.inject({
      method: 'GET',
      url,
      headers: { cookie: f.cookie, 'x-company-id': f.company },
    });
    times.push(performance.now() - start);
    expect(res.statusCode).toBe(200);
  }

  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
  expect(p95).toBeLessThan(200);
});
