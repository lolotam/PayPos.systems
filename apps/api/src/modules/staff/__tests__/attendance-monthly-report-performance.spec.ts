import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceMonthlyReport } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { computeAttendanceMonthlyReport } from '@pospay/domain';
import { attendanceReportScope } from '../persistence/attendance-report-access.adapter.ts';
import { monthlyReportLoadFixture } from './attendance-monthly-report-load.fixture.ts';
import { reportHeaders, reportUrl, type MonthlyReportFixture } from './attendance-monthly-report.fixture.ts';
import { attendanceMonthlyInputs, attendanceMonthlyInputsStatement } from '../queries/attendance-monthly-report.query.ts';

let f: MonthlyReportFixture;
beforeAll(async () => { f = await monthlyReportLoadFixture(); });
afterAll(async () => { await f?.db.close(); await f?.h.close(); });

it('60 employees x 31 days, 3,720 sessions: full authenticated JSON and audited CSV responses stay under 200ms', async () => {
  const maxima: number[] = [];
  for (const csv of [false,true]) {
    const samples: number[] = [];
    for (let index = 0; index < 12; index++) {
      const start = performance.now();
      const response = await f.h.app.inject({method:'GET',url:reportUrl(f,f.branch,csv),headers:reportHeaders(f)});
      const elapsed = performance.now()-start;
      expect(response.statusCode).toBe(200);
      if (!csv) {
        const report = attendanceMonthlyReport.parse(response.json());
        expect(report.rows).toHaveLength(60);
        for (const row of report.rows) expect(row).toMatchObject({days_present:31,worked_minutes:14880,
          contracted_minutes:14880,scheduled_minutes:14880,difference_minutes:0});
      }
      if (index >= 2) samples.push(elapsed);
    }
    const sorted = samples.toSorted((a,b) => a-b);
    console.info('attendance_report_latency', {format:csv ? 'CSV' : 'JSON',samples:10,
      median_ms:Number(sorted[5]?.toFixed(2)),max_ms:Number(Math.max(...samples).toFixed(2))});
    maxima.push(Math.max(...samples));
  }
  expect(Math.max(...maxima)).toBeLessThan(200);
});
it('the load plan uses existing tenant branch indexes and one input query per HTTP response', async () => {
  const scope = {businessId:f.business,branches:[{id:f.branch,timezone:'Asia/Kuwait'}]};
  const plans = await f.db.withTenant(f.company,async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${attendanceMonthlyInputsStatement(f.company,scope,'2026-10-01','2026-10-31')}`);
  });
  expect(JSON.stringify(plans)).toMatch(/attendance_sessions_(board|business_date|employee_date)_idx/);
  expect(JSON.stringify(plans)).toMatch(/staff_schedules_(branch_week_idx|week_key)/);
  const before = f.h.calls.statements.length;
  await f.h.app.inject({method:'GET',url:reportUrl(f),headers:reportHeaders(f)});
  const inputs = f.h.calls.statements.slice(before).filter((entry) => entry.sql.includes('WITH contracts AS MATERIALIZED'));
  expect(inputs).toHaveLength(1);
  const start = performance.now();
  await f.db.withTenant(f.company,(tx) => attendanceReportScope(tx,f.company,f.userId,f.business,f.branch));
  const access = performance.now();
  const rows = await f.db.withTenant(f.company,(tx) => attendanceMonthlyInputs(tx,f.company,scope,'2026-10-01','2026-10-31'));
  const query = performance.now();
  rows.map((row) => computeAttendanceMonthlyReport(row.branches,'2026-10'));
  console.info('attendance_report_profile',{access_ms:access-start,query_ms:query-access,domain_ms:performance.now()-query,
    plan_ms:JSON.stringify(plans).match(/"Execution Time":([\d.]+)/)?.[1]});
});
