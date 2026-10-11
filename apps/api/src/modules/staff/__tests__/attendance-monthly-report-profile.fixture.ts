import { attendanceMonthlyReport } from '@pospay/contracts';
import { computeAttendanceMonthlyReport } from '@pospay/domain';
import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { attendanceReportScope } from '../persistence/attendance-report-access.adapter.ts';
import { attendanceMonthlyInputs } from '../queries/attendance-monthly-report.query.ts';
import type { MonthlyReportFixture } from './attendance-monthly-report.fixture.ts';
import { writeFileSync } from 'node:fs';
import { PgDialect } from 'drizzle-orm/pg-core';

type StatementTiming = { statement: number; label: string; wall_ms: number; planning_ms: number; execution_ms: number };

// EXPLAIN لا ينقل مدخلات الشهر؛ الفرق عن زمن التنفيذ العادي تقدير للنقل وفك JSON والبروتوكول، وليس قياس شبكة مستقل.
function profiledTx(tx: Tx, timings: StatementTiming[], statements: SQL[]): Tx {
  return new Proxy(tx, { get: (target, property, receiver) => property === 'execute' ? async (query: SQL) => {
    const start = performance.now();
    const rows = await target.execute(query);
    const text = new PgDialect().sqlToQuery(query).sql;
    timings.push({ statement: timings.length + 1, label: text.includes('WITH contracts') ? 'report inputs' :
      text.includes('WITH active') ? 'grants' : text.includes('company_feature_overrides') ? 'feature' :
      text.includes('SELECT DISTINCT branch_id') ? 'historical branches' : 'workspaces',
    wall_ms: performance.now() - start, planning_ms: 0, execution_ms: 0 });
    statements.push(query);
    return rows;
  } : Reflect.get(target, property, receiver) });
}

export async function monthlyReportProfile(f: MonthlyReportFixture) {
  const timings: StatementTiming[] = [], statements: SQL[] = [];
  const start = performance.now();
  const report = await f.db.withTenant(f.company, async (tx) => {
    const profiled = profiledTx(tx, timings, statements);
    const scope = await attendanceReportScope(profiled, f.company, f.userId, f.business, 'all', '2026-10');
    if (typeof scope === 'string') throw new Error(scope);
    const rows = await attendanceMonthlyInputs(profiled, f.company, scope, '2026-10-01', '2026-10-31');
    const domainStart = performance.now();
    const computed = rows.map((row) => ({ employee_id: row.employee_id, name_ar: row.name_ar, name_en: row.name_en,
      ...computeAttendanceMonthlyReport(row.branches, '2026-10') }));
    const domainEnd = performance.now();
    const view = attendanceMonthlyReport.parse({ business_id: f.business, branch_id: 'all', month: '2026-10', rows: computed });
    const validationEnd = performance.now();
    const body = JSON.stringify(view);
    return { domain_ms: domainEnd - domainStart, validation_ms: validationEnd - domainEnd,
      serialization_ms: performance.now() - validationEnd, bytes: Buffer.byteLength(body), rows: view.rows.length };
  }, { userId: f.userId });
  const total = performance.now() - start;
  await f.db.withTenant(f.company, async (tx) => {
    for (const [index, statement] of statements.entries()) {
      const plans = await tx.execute<{ 'QUERY PLAN': { 'Planning Time': number; 'Execution Time': number }[] }>(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`);
      const plan = plans[0]?.['QUERY PLAN'][0], timing = timings[index];
      if (!plan || !timing) throw new Error('MISSING_PROFILE_PLAN');
      timing.planning_ms = plan['Planning Time'];
      timing.execution_ms = plan['Execution Time'];
    }
  }, { userId: f.userId });
  const sqlMs = timings.reduce((sum, item) => sum + item.execution_ms, 0);
  const planning = timings.reduce((sum, item) => sum + item.planning_ms, 0);
  const wall = timings.reduce((sum, item) => sum + item.wall_ms, 0);
  const split = { ...report, sql_execution_ms: sqlMs, sql_planning_ms: planning,
    transfer_parse_protocol_estimate_ms: wall - sqlMs - planning,
    transaction_overhead_ms: total - wall - report.domain_ms - report.validation_ms - report.serialization_ms, total_ms: total };
  console.info('attendance_report_sql_profile', timings);
  console.info('attendance_report_split', split);
  const output = process.env['REPORT_PROFILE_FILE'];
  if (output) writeFileSync(output, JSON.stringify({ statements: timings, split }, null, 2));
}
