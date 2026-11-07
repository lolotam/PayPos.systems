import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import type postgres from 'postgres';
import { leaveHistoryPage } from '@pospay/contracts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { leaveHistorySql } from '../queries/leave-history.query.ts';
import {
  historyNow,
  historyQuery,
  historyRead,
  leaveContext,
  leaveFixture,
  type LeaveFixture,
} from './leave-history.fixture.ts';
import {
  foreignTenants,
  performanceVolume,
  seedHistoryVolume,
} from './leave-history-performance.fixture.ts';
let f: LeaveFixture;
let baseline: Baseline;
// حدود الإعداد بتتسجل عشان أي timeout في الـhook يبان عند أنهي خطوة وقف، مش فشل عام.
const setupStep = (step: string) =>
  console.info(JSON.stringify({ setup: step, at: new Date().toISOString() }));
beforeAll(async () => {
  setupStep('leaveFixture:start');
  f = await leaveFixture({ hireDate: '2025-01-01' });
  setupStep('leaveFixture:end');
  setupStep('jsonbProbe:start');
  await f.h.owner.begin(async (tx) => {
    const [probe] = await tx.unsafe('SELECT jsonb_typeof($1::text::jsonb) AS kind', [
      '[{"probe":true}]',
    ]);
    expect(probe).toEqual({ kind: 'array' });
  });
  setupStep('jsonbProbe:end');
  await seedHistoryVolume(f);
  setupStep('seed:end');
  const [year] = await f.h.owner`SELECT count(*)::int AS leaves,
    count(*) FILTER (WHERE employee_id=${f.employee.id})::int AS measured,
    min("from")::text AS first, max("to")::text AS last
    FROM leave_requests WHERE company_id=${f.company}`;
  expect(year).toEqual({ leaves: 1_000, measured: 20, first: '2025-11-07', last: '2026-11-01' });
  const [tenants] = await f.h.owner`SELECT count(DISTINCT company_id)::int AS shifts,
    (SELECT count(DISTINCT company_id)::int FROM leave_requests) AS leaves,
    (SELECT count(DISTINCT company_id)::int FROM employees WHERE company_id<>${f.otherCompany}) AS employees
    FROM staff_schedule_shifts`;
  expect(tenants).toEqual({
    shifts: foreignTenants + 1,
    leaves: foreignTenants + 1,
    employees: foreignTenants + 1,
  });
  const visible = await f.db.withTenant(f.company, async (tx) => {
    const [row] = await tx.execute(sql`SELECT
      (SELECT count(*)::int FROM staff_schedule_shifts) AS shifts,
      (SELECT count(*)::int FROM leave_requests) AS leaves,
      (SELECT count(DISTINCT company_id)::int FROM employees) AS companies`);
    return row;
  });
  expect(visible).toEqual({ shifts: 18_250, leaves: 1_000, companies: 1 });
  setupStep('snapshot:start');
  baseline = await snapshotBaseline();
  setupStep('snapshot:end');
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
type Node = {
  'Node Type': string;
  'Relation Name'?: string;
  'Actual Rows': number;
  'Actual Loops': number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  'Sort Space Type'?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Filter?: string;
  Plans?: Node[];
};
function nodes(node: Node): Node[] {
  return [node, ...(node.Plans ?? []).flatMap(nodes)];
}
const query = () => historyQuery({ from: '2025-11-07', to: '2026-11-06' });
const access = () => createLeaveReadAccess({ now: () => new Date('2026-11-07T10:00:00.000Z') });

const scenarios = ['no absence', 'old latest absence', 'missing leave types'];
// ترتيب مخالف لترتيب القياس، من غير قياس أداء: لو أي سيناريو بيعتمد على اللي قبله أو بيسرّب حالته، الاختبار ده يفشل.
it('scenario restore is independent of test order', async () => {
  const order = ['missing leave types', 'old latest absence', 'no absence', 'missing leave types'];
  for (const scenario of order.concat('no absence', 'old latest absence'))
    await restoreScenario(scenario);
});
for (const scenario of scenarios) {
  it(`EXPLAIN (ANALYZE, BUFFERS): ${scenario}`, async () => {
    await restoreScenario(scenario);
    const result = await f.db.withTenant(f.company, async (tx) => {
      const scope = await access().check(tx, leaveContext(f));
      if (!scope) throw new Error('Missing performance scope');
      return tx.execute(sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
      ${leaveHistorySql(leaveContext(f), query(), scope, { asOf: '2026-11-07T10:00:00.000Z', excludeOpen: true })}`);
    });
    const raw = result[0]?.['QUERY PLAN'] as { Plan: Node; 'Execution Time': number }[];
    const root = raw[0];
    if (!root) throw new Error('Missing JSON explain');
    const plan = nodes(root.Plan);
    const evidence = plan.map((n) => ({
      type: n['Node Type'],
      relation: n['Relation Name'],
      rows: n['Actual Rows'],
      loops: n['Actual Loops'],
      hits: n['Shared Hit Blocks'],
      reads: n['Shared Read Blocks'],
      sort: n['Sort Space Type'],
      index: n['Index Name'],
      indexCond: n['Index Cond'],
      filter: n.Filter,
    }));
    console.info(
      JSON.stringify({
        scenario,
        initialVolume: performanceVolume,
        measuredCounts: await measuredCounts(),
        executionMs: root['Execution Time'],
        evidence,
      }),
    );
    expect(
      plan.filter(
        (n) =>
          [
            'leave_requests',
            'staff_schedule_shifts',
            'attendance_sessions',
            'staff_schedules',
            'employees',
          ].includes(n['Relation Name'] ?? '') && n['Node Type'] === 'Seq Scan',
      ),
    ).toEqual([]);
    expect(Math.max(...plan.map((n) => n['Actual Rows'] * n['Actual Loops']))).toBeLessThan(
      100_000,
    );
    expect(
      (root.Plan['Shared Hit Blocks'] ?? 0) + (root.Plan['Shared Read Blocks'] ?? 0),
    ).toBeLessThan(100_000);
    expect(plan.some((n) => n['Sort Space Type'] === 'Disk')).toBe(false);
    expect(root['Execution Time']).toBeLessThanOrEqual(200);
  });
  it(`HTTP p95 <= 200 ms: ${scenario}`, async () => {
    await restoreScenario(scenario);
    await measureSamples(scenario);
  });
}
async function measureSamples(scenario: string) {
  const startedAt = new Date().toISOString();
  const read = async () => {
    const result = await f.h.app.inject({
      method: 'GET',
      url: `/v1/businesses/${f.business}/employees/${f.employee.id}/leave-history?from=2025-11-07&to=2026-11-06`,
      headers: { cookie: f.cookie, 'x-company-id': f.company },
    });
    expect(result.statusCode).toBe(200);
    const page = leaveHistoryPage.parse(result.json());
    expect(page.items.every((r) => r.employee_id === f.employee.id)).toBe(true);
    expect(page.items.every((r) => [f.branch, f.secondBranch].includes(r.branch_id))).toBe(true);
  };
  for (let n = 0; n < 5; n++) await read();
  const samples: number[] = [];
  for (let n = 0; n < 50; n++) {
    const start = performance.now();
    await read();
    samples.push(performance.now() - start);
  }
  const sorted = [...samples].sort((a, b) => a - b),
    p95 = sorted[Math.ceil(samples.length * 0.95) - 1];
  console.info(
    JSON.stringify({
      scenario,
      startedAt,
      finishedAt: new Date().toISOString(),
      sampleCount: samples.length,
      warmups: 5,
      samples,
      p95,
      initialVolume: performanceVolume,
      measuredCounts: await measuredCounts(),
      foreignTenants,
      machine: {
        node: process.version,
        platform: platform(),
        release: release(),
        cpu: cpus()[0]?.model,
        cores: cpus().length,
      },
      conditions:
        'sequential Fastify HTTP inject reads; warm DB; one business; no concurrent test files; includes guards, authorization, transaction and serialization; excludes network transport',
      historyNow,
    }),
  );
  expect(p95).toBeLessThanOrEqual(200);
}

type Coverage = 'all' | 'not covering' | 'none';
type Baseline = {
  sessions: string;
  leaves: string;
  sessionIds: string[];
  leaveIds: Record<Coverage, string[]>;
};
// صفوف الموظف المقاس اللي السيناريوهات بتغيّرها، محفوظة بقيمها كاملة بعد الـseed مرة واحدة.
// الرجوع ليها قبل كل اختبار بيخلي كل سيناريو مستقل عن ترتيب الاختبارات وعن اختيار -t.
async function snapshotBaseline(): Promise<Baseline> {
  const [row] = await f.h.owner`SELECT
    (SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]')::text FROM attendance_sessions s WHERE company_id=${f.company}
      AND employee_id=${f.employee.id} AND working_date='2025-11-07') AS sessions,
    (SELECT coalesce(jsonb_agg(to_jsonb(l)), '[]')::text FROM leave_requests l WHERE company_id=${f.company}
      AND employee_id=${f.employee.id}) AS leaves,
    (SELECT coalesce(array_agg(id::text), '{}') FROM leave_requests WHERE company_id=${f.company}
      AND employee_id=${f.employee.id} AND NOT ("from"<='2025-11-07' AND "to">='2025-11-07')) AS not_covering`;
  const sessions = JSON.parse(row?.['sessions'] as string) as { id: string }[];
  const leaves = JSON.parse(row?.['leaves'] as string) as { id: string }[];
  const notCovering = row?.['not_covering'] as string[];
  expect({
    sessions: sessions.length,
    leaves: leaves.length,
    notCovering: notCovering.length,
  }).toEqual({
    sessions: 1,
    leaves: 20,
    notCovering: 19,
  });
  // المسح وإعادة الإدخال آمنين بس لو مفيش صف تابع بيشاور على الجلسة (FK من غير cascade).
  const ids = sessions.map((s) => s.id);
  const [children] = await f.h.owner`SELECT
    (SELECT count(*)::int FROM attendance_exceptions WHERE company_id=${f.company} AND session_id=ANY(${f.h.owner.array(ids)}::uuid[]))
    + (SELECT count(*)::int FROM attendance_corrections WHERE company_id=${f.company} AND session_id=ANY(${f.h.owner.array(ids)}::uuid[]))
    + (SELECT count(*)::int FROM attendance_change_requests WHERE company_id=${f.company} AND session_id=ANY(${f.h.owner.array(ids)}::uuid[]))
    AS referencing`;
  expect(children).toEqual({ referencing: 0 });
  return {
    sessions: row?.['sessions'] as string,
    leaves: row?.['leaves'] as string,
    sessionIds: [...ids].sort(),
    leaveIds: {
      all: leaves.map((l) => l.id).sort(),
      'not covering': [...notCovering].sort(),
      none: [],
    },
  };
}
// الحالة المستهدفة لكل سيناريو كجزء من الـbaseline المحفوظ، بنفس الـIDs والقيم.
const scenarioRows: Record<string, { session: boolean; leaves: Coverage }> = {
  'no absence': { session: true, leaves: 'all' },
  'old latest absence': { session: false, leaves: 'not covering' },
  'missing leave types': { session: true, leaves: 'none' },
};
async function restoreScenario(scenario: string) {
  const target = scenarioRows[scenario];
  if (!target) throw new Error(`Unknown scenario ${scenario}`);
  await f.h.owner.begin(async (tx) => {
    await tx`DELETE FROM attendance_sessions WHERE company_id=${f.company} AND employee_id=${f.employee.id}
      AND working_date='2025-11-07'`;
    await tx`DELETE FROM leave_requests WHERE company_id=${f.company} AND employee_id=${f.employee.id}`;
    if (target.session) await reinsertSession(tx);
    if (target.leaves === 'all') await reinsertAllLeaves(tx);
    if (target.leaves === 'not covering') await reinsertNotCoveringLeaves(tx);
  });
  await expectScenarioState(scenario, target);
}
async function columnsOf(
  tx: postgres.TransactionSql,
  table: 'attendance_sessions' | 'leave_requests',
) {
  const [row] = await tx`SELECT string_agg(format('%I', attname), ',' ORDER BY attnum) AS names
    FROM pg_attribute WHERE attrelid=${table}::regclass AND attnum>0 AND NOT attisdropped AND attgenerated=''`;
  return row?.['names'] as string;
}
async function reinsertSession(tx: postgres.TransactionSql) {
  const names = await columnsOf(tx, 'attendance_sessions');
  await tx.unsafe(
    `INSERT INTO attendance_sessions(${names}) SELECT ${names}
    FROM jsonb_populate_recordset(NULL::attendance_sessions, $1::text::jsonb)`,
    [baseline.sessions],
  );
}
async function reinsertAllLeaves(tx: postgres.TransactionSql) {
  const names = await columnsOf(tx, 'leave_requests');
  await tx.unsafe(
    `INSERT INTO leave_requests(${names}) SELECT ${names}
    FROM jsonb_populate_recordset(NULL::leave_requests, $1::text::jsonb)`,
    [baseline.leaves],
  );
}
async function reinsertNotCoveringLeaves(tx: postgres.TransactionSql) {
  const names = await columnsOf(tx, 'leave_requests');
  await tx.unsafe(
    `INSERT INTO leave_requests(${names}) SELECT ${names}
    FROM jsonb_populate_recordset(NULL::leave_requests, $1::text::jsonb)
    WHERE NOT ("from"<='2025-11-07' AND "to">='2025-11-07')`,
    [baseline.leaves],
  );
}
// إثبات الحالة قبل القياس: نفس IDs الـbaseline بالظبط لكل سيناريو، مش أي 19 من 20.
async function expectScenarioState(
  scenario: string,
  target: { session: boolean; leaves: Coverage },
) {
  const [state] = await f.h.owner`SELECT
    (SELECT coalesce(array_agg(id::text), '{}') FROM attendance_sessions WHERE company_id=${f.company}
      AND employee_id=${f.employee.id} AND working_date='2025-11-07') AS session_ids,
    (SELECT coalesce(array_agg(id::text), '{}') FROM leave_requests WHERE company_id=${f.company}
      AND employee_id=${f.employee.id}) AS leave_ids`;
  const evidence = {
    scenario,
    sessionIds: [...(state?.['session_ids'] as string[])].sort(),
    leaveIds: [...(state?.['leave_ids'] as string[])].sort(),
  };
  console.info(
    JSON.stringify({
      restored: evidence.scenario,
      sessions: evidence.sessionIds.length,
      leaves: evidence.leaveIds.length,
    }),
  );
  expect(evidence.sessionIds).toEqual(target.session ? baseline.sessionIds : []);
  expect(evidence.leaveIds).toEqual(baseline.leaveIds[target.leaves]);
  if (scenario === 'missing leave types')
    expect((await historyRead(f, query(), '2026-11-07T10:00:00.000Z')).last_taken).toEqual({
      annual: null,
      sick: null,
      unpaid: null,
      unexcused_absence: null,
    });
}
async function measuredCounts() {
  const [counts] = await f.h.owner`SELECT current_setting('server_version') AS postgres_version,
    (SELECT count(*)::int FROM staff_schedule_shifts WHERE company_id=${f.company}) AS shifts,
    (SELECT count(*)::int FROM attendance_sessions WHERE company_id=${f.company}) AS sessions,
    (SELECT count(*)::int FROM leave_requests WHERE company_id=${f.company}) AS leaves,
    (SELECT count(*)::int FROM staff_schedule_shifts) AS all_shifts,
    (SELECT count(*)::int FROM attendance_sessions) AS all_sessions,
    (SELECT count(*)::int FROM leave_requests) AS all_leaves,
    (SELECT count(*)::int FROM staff_schedules) AS all_schedules,
    (SELECT count(*)::int FROM employees) AS all_employees`;
  return counts;
}
