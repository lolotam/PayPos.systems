import {
  latestAsOf,
  latestExpected,
  latestPlanNodes,
  latestStatement,
  latestVolume,
  restoreLatestScenario,
  seedLatestYears,
  type ExplainNode,
  type LatestScenario,
} from './leave-history-latest-absence.fixture.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { performance } from 'node:perf_hooks';
import { cpus, platform, release } from 'node:os';
import { leaveHistoryPage } from '@pospay/contracts';
import { historyRead, leaveFixture, type LeaveFixture } from './leave-history.fixture.ts';

let f: LeaveFixture;
beforeAll(async () => {
  f = await leaveFixture({ hireDate: '2020-01-01' });
  await seedLatestYears(f);
  await f.h.owner`UPDATE memberships SET scope_type='BRANCH',scope_id=${f.branch}
    WHERE company_id=${f.company} AND id=${f.memberId}`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

async function restore(scenario: LatestScenario) {
  const counts = await restoreLatestScenario(f, scenario);
  expect(counts).toEqual({
    schedules: 358,
    shifts: 2_502,
    leaves: 0,
    sessions: scenario === 'recent' ? 0 : scenario === 'old' ? 2_501 : 2_502,
    first: '2020-01-01',
    last: '2026-11-06',
  });
  const page = await historyRead(f, { from: '2026-11-01', to: '2026-11-06' });
  expect(page.last_taken).toEqual({
    annual: null,
    sick: null,
    unpaid: null,
    unexcused_absence: latestExpected[scenario],
  });
  expect(page.items).toHaveLength(6);
  expect(page.items.map((r) => (r.row_type === 'LEAVE' ? r.from : r.working_date))).toEqual([
    '2026-11-06',
    '2026-11-05',
    '2026-11-04',
    '2026-11-03',
    '2026-11-02',
    '2026-11-01',
  ]);
  expect(
    page.items.every(
      (r) => r.row_type === (scenario === 'recent' ? 'UNEXCUSED_ABSENCE' : 'COVERED_ELSEWHERE'),
    ),
  ).toBe(true);
  return counts;
}

for (const scenario of ['recent', 'old', 'none'] as const) {
  it(`#900 EXPLAIN ANALYZE BUFFERS multi-year ${scenario}`, async () => {
    const counts = await restore(scenario);
    const statement = await latestStatement(f);
    const rows = await f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${statement}`),
    );
    const raw = rows[0]?.['QUERY PLAN'] as { Plan: ExplainNode; 'Execution Time': number }[];
    const root = raw[0];
    if (!root) throw new Error('LATEST_ABSENCE_EXPLAIN_MISSING');
    const nodes = latestPlanNodes(root.Plan);
    const scans = nodes.filter((n) => n['Relation Name'] === 'staff_schedule_shifts');
    const shiftWork = scans.reduce(
      (sum, n) =>
        sum +
        n['Actual Loops'] *
          (n['Actual Rows'] +
            (n['Rows Removed by Filter'] ?? 0) +
            (n['Rows Removed by Index Recheck'] ?? 0)),
      0,
    );
    const buffers = (root.Plan['Shared Hit Blocks'] ?? 0) + (root.Plan['Shared Read Blocks'] ?? 0);
    console.info(
      JSON.stringify({
        issue: 900,
        scenario,
        counts,
        shiftWork,
        buffers,
        executionMs: root['Execution Time'],
        evidence: nodes,
      }),
    );
    expect(scans.length).toBeGreaterThan(0);
    expect(scans.some((n) => n['Actual Loops'] > 0)).toBe(true);
    expect(nodes.some((n) => n['Sort Space Type'] === 'Disk')).toBe(false);
    expect(root['Execution Time']).toBeLessThanOrEqual(200);
    if (scenario === 'recent') {
      // حجم التاريخ ثابت؛ المطلوب توقف فعلي قبل لمس آلاف الورديات، مش LIMIT بعد تجميعهم.
      expect(shiftWork).toBeLessThanOrEqual(64);
      expect(scans.some((n) => n['Node Type'].includes('Index') && n['Actual Loops'] > 0)).toBe(
        true,
      );
      expect(buffers).toBeLessThan(2_048);
    }
    // القديم وغياب الغياب مسموح يفحصوا التاريخ كله؛ بنسجل الشغل من غير ادعاء O(1).
  });

  it(`#900 HTTP p95 <= 200 ms multi-year ${scenario}: 5 warmups / 50 samples`, async () => {
    const counts = await restore(scenario);
    for (let n = 0; n < 5; n++) await readHttp(scenario);
    const samples: number[] = [];
    for (let n = 0; n < 50; n++) {
      const start = performance.now();
      await readHttp(scenario);
      samples.push(performance.now() - start);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(samples.length * 0.95) - 1];
    console.info(
      JSON.stringify({
        issue: 900,
        scenario,
        latestAsOf,
        initialVolume: latestVolume,
        counts,
        warmups: 5,
        sampleCount: samples.length,
        samples,
        p95,
        machine: {
          node: process.version,
          platform: platform(),
          release: release(),
          cpu: cpus()[0]?.model,
          cores: cpus().length,
        },
        conditions:
          'sequential Fastify inject; guards/auth/transaction/serialization included; warm DB; Redis boundary mocked; no network transport',
      }),
    );
    expect(samples).toHaveLength(50);
    expect(p95).toBeLessThanOrEqual(200);
  });
}

async function readHttp(scenario: LatestScenario) {
  const result = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/employees/${f.employee.id}/leave-history?from=2026-11-01&to=2026-11-06`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
  });
  expect(result.statusCode).toBe(200);
  const page = leaveHistoryPage.parse(result.json());
  expect(page.last_taken).toEqual({
    annual: null,
    sick: null,
    unpaid: null,
    unexcused_absence: latestExpected[scenario],
  });
  expect(page.items).toHaveLength(6);
  expect(page.items.every((r) => r.employee_id === f.employee.id && r.branch_id === f.branch)).toBe(
    true,
  );
  expect(
    page.items.every(
      (r) => r.row_type === (scenario === 'recent' ? 'UNEXCUSED_ABSENCE' : 'COVERED_ELSEWHERE'),
    ),
  ).toBe(true);
}
