import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { leaveHistorySql } from '../queries/leave-history.query.ts';
import {
  historyNow,
  historyQuery,
  historyRead,
  historySession,
  leaveContext,
  leaveFixture,
  type LeaveFixture,
} from './leave-history.fixture.ts';
import { performanceVolume, seedHistoryVolume } from './leave-history-performance.fixture.ts';
let f: LeaveFixture;
beforeAll(async () => {
  f = await leaveFixture({ hireDate: '2025-01-01' });
  await seedHistoryVolume(f);
  const [year] = await f.h.owner`SELECT count(*)::int AS leaves,
    count(*) FILTER (WHERE employee_id=${f.employee.id})::int AS measured,
    min("from")::text AS first, max("to")::text AS last
    FROM leave_requests WHERE company_id=${f.company}`;
  expect(year).toEqual({ leaves: 1_000, measured: 20, first: '2025-11-07', last: '2026-11-01' });
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
  Plans?: Node[];
};
function nodes(node: Node): Node[] {
  return [node, ...(node.Plans ?? []).flatMap(nodes)];
}
const query = () => historyQuery({ from: '2025-11-07', to: '2026-11-06' });
const access = () => createLeaveReadAccess({ now: () => new Date('2026-11-07T10:00:00.000Z') });

it.each(['no absence', 'old latest absence', 'missing leave types'])(
  'EXPLAIN (ANALYZE, BUFFERS): %s',
  async (scenario) => {
    await prepareScenario(scenario);
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
          ['leave_requests', 'staff_schedule_shifts', 'attendance_sessions'].includes(
            n['Relation Name'] ?? '',
          ) && n['Node Type'] === 'Seq Scan',
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
    await measureSamples(scenario);
  },
);
async function measureSamples(scenario: string) {
  const startedAt = new Date().toISOString();
  const read = async () => {
    const result = await f.h.app.inject({
      method: 'GET',
      url: `/v1/businesses/${f.business}/employees/${f.employee.id}/leave-history?from=2025-11-07&to=2026-11-06`,
      headers: { cookie: f.cookie, 'x-company-id': f.company },
    });
    expect(result.statusCode).toBe(200);
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

async function prepareScenario(scenario: string) {
  if (scenario === 'old latest absence') {
    await f.h
      .owner`DELETE FROM attendance_sessions WHERE company_id=${f.company} AND employee_id=${f.employee.id}
      AND working_date='2025-11-07'`;
    await f.h
      .owner`DELETE FROM leave_requests WHERE company_id=${f.company} AND employee_id=${f.employee.id}
      AND "from"<='2025-11-07' AND "to">='2025-11-07'`;
  }
  if (scenario === 'missing leave types') {
    await historySession(f, '2025-11-07', { status: 'CLOSED' });
    await f.h
      .owner`DELETE FROM leave_requests WHERE company_id=${f.company} AND employee_id=${f.employee.id}`;
    expect((await historyRead(f, query(), '2026-11-07T10:00:00.000Z')).last_taken).toEqual({
      annual: null,
      sick: null,
      unpaid: null,
      unexcused_absence: null,
    });
  }
}
async function measuredCounts() {
  const [counts] = await f.h.owner`SELECT current_setting('server_version') AS postgres_version,
    (SELECT count(*)::int FROM staff_schedule_shifts WHERE company_id=${f.company}) AS shifts,
    (SELECT count(*)::int FROM attendance_sessions WHERE company_id=${f.company}) AS sessions,
    (SELECT count(*)::int FROM leave_requests WHERE company_id=${f.company}) AS leaves`;
  return counts;
}
