import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { leaveHistoryReportQuery, type LeaveHistoryReportQuery } from '@pospay/contracts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { leaveHistorySql } from '../queries/leave-history.query.ts';
import { leaveFixture, leaveIds, type LeaveFixture } from './leave-history.fixture.ts';
import { seedHistoryVolume } from './leave-history-performance.fixture.ts';

// #947: every shift day probes leave_requests; past leaves outside the period must not be read.
const coverageIndex = 'leave_requests_company_employee_to_from_idx';
const pastLeavesPerEmployee = 120;

let f: LeaveFixture;
const access = createLeaveReadAccess({ now: () => new Date('2026-11-07T10:00:00.000Z') });

beforeAll(async () => {
  f = await leaveFixture({ hireDate: '2025-01-01' });
  await seedHistoryVolume(f);
  await seedPastLeaves();
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

// 120 approved one-day leaves per employee in 2020, years before every period the tests read.
async function seedPastLeaves() {
  const rows = await f.h.owner`SELECT id FROM employees
    WHERE company_id=${f.company} AND business_id=${f.business} AND deleted_at IS NULL ORDER BY id`;
  const employees = rows.map((row) => String(row['id']));
  const ids = Array.from({ length: pastLeavesPerEmployee * employees.length }, () =>
    leaveIds.newId(),
  );
  await f.h.owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,
      "from","to",timezone,starts_at,ends_at,type,status,requested_by,requested_at,decided_by,decided_at)
    SELECT ${f.company},s.id,${f.business},${f.branch},
      (${f.h.owner.array(employees)}::uuid[])[((s.n-1)%${employees.length}+1)::int],'FULL_DAY',
      date '2020-01-01'+s.day,date '2020-01-01'+s.day,'UTC',
      timestamptz '2020-01-01T00:00:00Z'+s.day*interval '1 day',
      timestamptz '2020-01-02T00:00:00Z'+s.day*interval '1 day',
      'ANNUAL','APPROVED',${f.userId},now(),${f.userId},now()
    FROM (SELECT u.id,u.n,((u.n-1)/${employees.length})::int*3 AS day
      FROM unnest(${f.h.owner.array(ids)}::uuid[]) WITH ORDINALITY u(id,n)) s`;
  await f.h.owner`ANALYZE leave_requests`;
}

type PlanNode = {
  'Node Type'?: string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Filter?: string;
  'Recheck Cond'?: string;
  Plans?: PlanNode[];
};

// The coverage probe is the leave_requests read correlated with the shift day.
function coverageProbes(node: PlanNode, found: PlanNode[] = []): PlanNode[] {
  const conditions = [node['Index Cond'], node.Filter, node['Recheck Cond']].join(' ');
  if (node['Relation Name'] === 'leave_requests' && conditions.includes('working_date')) {
    found.push(node);
  }
  for (const child of node.Plans ?? []) coverageProbes(child, found);
  return found;
}

async function explainReport(q: LeaveHistoryReportQuery) {
  const result = await f.db.withTenant(f.company, async (tx) => {
    const context = {
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      own: false,
      ...(q.employee_id === undefined ? {} : { employeeId: q.employee_id }),
    };
    const scope = await access.check(tx, {
      ...context,
      ...(q.employee_id === undefined ? {} : { purpose: 'history' as const }),
    });
    if (!scope) throw new Error('Coverage scope missing');
    const statement = leaveHistorySql(context, q, scope, {
      asOf: scope.now.toISOString(),
      excludeOpen: false,
      report: { attachment: 'current' },
    });
    return tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`);
  });
  const raw = result[0]?.['QUERY PLAN'] as [{ Plan: PlanNode; 'Execution Time': number }];
  const root = raw[0];
  if (!root) throw new Error('Missing EXPLAIN JSON');
  return root;
}

function expectIndexedProbes(plan: PlanNode) {
  const probes = coverageProbes(plan);
  expect(probes.length).toBeGreaterThan(0);
  for (const probe of probes) {
    expect(['Index Scan', 'Index Only Scan']).toContain(probe['Node Type']);
    expect(probe['Index Name']).toBe(coverageIndex);
    // Both date bounds sit in the index condition, so the range starts at the shift day.
    expect(probe['Index Cond']).toMatch(/"to" >= \w+\.working_date/);
    expect(probe['Index Cond']).toMatch(/"from" <= \w+\.working_date/);
  }
}

// The employee-filtered read is the path the employee tab shares with the report.
it.each([
  ['the unfiltered report at the shift limit', () => ({ from: '2026-09-22', to: '2026-10-31' })],
  [
    'one employee over the full year',
    () => ({ from: '2025-11-07', to: '2026-11-06', employee_id: f.employee.id }),
  ],
])('coverage probe for %s reads an index range from the shift day (#947)', async (_, query) => {
  const root = await explainReport(leaveHistoryReportQuery.parse(query()));
  expectIndexedProbes(root.Plan);
  expect(root['Execution Time']).toBeLessThanOrEqual(200);
});
