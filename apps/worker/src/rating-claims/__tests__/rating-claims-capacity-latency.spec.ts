// قياس السعة وزمن المطالبة على الـ lane المعزول: خط أساس غير متزاحم، ثم حمل متزاحم متعدد الشركات.
import { cpus, release, type } from 'node:os';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT } from '../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  FORWARD_VISITS,
  RETRY_VISITS,
} from '../../modules/customers/domain/rating-claim-scheduling.ts';
import { openSecondCompany, secondCompanyTarget } from './rating-claims-recovery.fixture.ts';
import { seedDueRows, seedPlan } from './rating-claims-rows.fixture.ts';
import { ratingClaimsWorld, type RatingClaimsWorld } from './rating-claims-world.fixture.ts';
import {
  competingQueries,
  historyOf,
  percentiles,
  turn,
  type TurnRun,
} from './rating-claims-capacity.fixture.ts';

const BASE_COUNT = 120;
const CONTENDED_COUNT = 120;
const POOL_MAX = 10;
const ROUNDS = 6;

let world: RatingClaimsWorld;

beforeAll(async () => {
  world = await ratingClaimsWorld({ tokens: true, maxConnections: POOL_MAX });
  await openSecondCompany(world);
  await world.seedDueRequests({ count: BASE_COUNT, first: 1 });
  await seedDueRows(
    world.base.owner,
    seedPlan(secondCompanyTarget(), { count: CONTENDED_COUNT, first: 401 }),
  );
  await historyOf(world.base.owner, world.company, TENANT.A.business, world.branchId);
  await historyOf(world.base.owner, world.otherCompany, TENANT.B.business, TENANT.B.branch);
});

afterAll(async () => {
  await world?.close();
});

interface Phase {
  readonly samples: number[];
  readonly failures: number[];
  readonly turns: TurnRun[];
}

/** خط الأساس: أدوار متتابعة لشركة واحدة من غير تزاحم. */
async function baselinePhase(): Promise<Phase> {
  const samples: number[] = [];
  const failures: number[] = [];
  const turns: TurnRun[] = [];
  for (let round = 0; round < 3; round += 1) {
    turns.push(await turn(world, world.company, samples, failures));
  }
  return { samples, failures, turns };
}

/** الحمل المتزاحم: شركة في دورين متداخلين، وشركة تانية، واستعلامات على نفس الـ pool. */
async function contendedPhase(): Promise<Phase> {
  const samples: number[] = [];
  const failures: number[] = [];
  const turns: TurnRun[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const runs = await Promise.all([
      turn(world, world.company, samples, failures),
      turn(world, world.company, samples, failures),
      turn(world, world.otherCompany, samples, failures),
      competingQueries(world, 4),
    ]);
    turns.push(...(runs.slice(0, 3) as TurnRun[]));
  }
  return { samples, failures, turns };
}

/** الدفعة الجديدة لكل شركة، عشان الحمل يقيس شغلاً حقيقياً. */
async function seedContendedBatches(): Promise<void> {
  await world.seedDueRequests({ count: CONTENDED_COUNT, first: 201 });
  await seedDueRows(
    world.base.owner,
    seedPlan(secondCompanyTarget(), { count: CONTENDED_COUNT, first: 601 }),
  );
}

/** عدّادات الوظيفة: الأخطاء، وإعادة المحاولة، والفيضان، والموعد النهائي، والمكرر. */
async function countersOf(phase: Phase) {
  const rows = await world.base.owner`SELECT company_id, status, cancel_reason FROM rating_requests
    WHERE company_id IN (${world.company}, ${world.otherCompany})`;
  const duplicates = await world.base.owner`SELECT rating_request_id FROM (
      SELECT payload->>'rating_request_id' AS rating_request_id FROM outbox
      WHERE event_type = 'RatingRequestReady') t
    GROUP BY rating_request_id HAVING count(*) > 1`;
  return {
    duplicates: duplicates.length,
    unknown: phase.failures.length,
    retry: phase.turns.reduce((total, run) => total + run.summary.settlements.RETRY, 0),
    overflow: world.diagnostics.overflows.length,
    pastDeadline: rows.filter((row) => row['cancel_reason'] === 'PAST_DEADLINE').length,
    scheduled: rows.filter((row) => row['status'] === 'SCHEDULED').length,
  };
}

/** ملخص كل شركة في الحمل المتزاحم: الأدوار، والزيارات، والتسويات. */
function perCompanyOf(contended: Phase) {
  return [world.company, world.otherCompany].map((companyId) => ({
    companyId,
    turns: contended.turns.filter((run) => run.companyId === companyId).length,
    visits: contended.turns
      .filter((run) => run.companyId === companyId)
      .reduce((total, run) => total + run.summary.forwardVisits + run.summary.retryVisits, 0),
    settlements: contended.turns
      .filter((run) => run.companyId === companyId)
      .reduce(
        (total, run) => ({
          TERMINAL: total.TERMINAL + run.summary.settlements.TERMINAL,
          ABSENT: total.ABSENT + run.summary.settlements.ABSENT,
          FUTURE_UNATTEMPTED: total.FUTURE_UNATTEMPTED + run.summary.settlements.FUTURE_UNATTEMPTED,
          RETRY: total.RETRY + run.summary.settlements.RETRY,
          DELEGATED: total.DELEGATED + run.summary.settlements.DELEGATED,
        }),
        { TERMINAL: 0, ABSENT: 0, FUTURE_UNATTEMPTED: 0, RETRY: 0, DELEGATED: 0 },
      ),
  }));
}

/** تقرير القياس الكامل: خط الأساس والحمل المتزاحم والنسب والعدّادات. */
function buildReport(
  baseline: Phase,
  contended: Phase,
  counters: Awaited<ReturnType<typeof countersOf>>,
) {
  const withRequestBaseline = percentiles(baseline.samples);
  const withRequestContended = percentiles(contended.samples);
  const seeded = BASE_COUNT + CONTENDED_COUNT * 3;
  const cpuInfo = cpus();
  return {
    generatedAt: new Date().toISOString(),
    environment: {
      cpu: `${cpuInfo[0]?.model ?? 'unknown'} (${cpuInfo.length} logical)`,
      os: `${type()} ${release()}`,
      date: new Date().toISOString().slice(0, 10),
    },
    settings: {
      tenantTimeoutMs: 1000,
      databasePoolMax: POOL_MAX,
      forwardVisits: FORWARD_VISITS,
      retryVisits: RETRY_VISITS,
      clock: world.base.clock.at.toISOString(),
    },
    baseline: {
      turns: baseline.turns.length,
      withRequest: withRequestBaseline,
      turnDurationMs: percentiles(baseline.turns.map((run) => run.durationMs)),
      enqueueToActiveMs: percentiles(baseline.turns.map((run) => run.enqueueToActiveMs)),
    },
    contended: {
      turns: contended.turns.length,
      withRequest: withRequestContended,
      turnDurationMs: percentiles(contended.turns.map((run) => run.durationMs)),
      enqueueToActiveMs: percentiles(contended.turns.map((run) => run.enqueueToActiveMs)),
      perCompany: perCompanyOf(contended),
    },
    ratio: {
      withRequestP95:
        withRequestBaseline.p95 === 0 ? 0 : withRequestContended.p95 / withRequestBaseline.p95,
      withRequestP99:
        withRequestBaseline.p99 === 0 ? 0 : withRequestContended.p99 / withRequestBaseline.p99,
    },
    counters: {
      unknown: counters.unknown,
      retry: counters.retry,
      overflow: counters.overflow,
      pastDeadline: counters.pastDeadline,
      duplicates: counters.duplicates,
    },
    backlog: { seeded, drained: seeded - counters.scheduled, remaining: counters.scheduled },
  };
}

it('measures the baseline and the contended capacity of the claim scheduler', async () => {
  const baseline = await baselinePhase();
  await seedContendedBatches();
  const contended = await contendedPhase();
  const report = buildReport(baseline, contended, await countersOf(contended));
  console.info('rating_claims_capacity_measurement', JSON.stringify(report));

  // ما فيش حد ثابت بالمللي ثانية؛ الفحوص وظيفية وبنسب تزاحم داخل نفس التشغيلة.
  expect(report.counters.unknown).toBe(0);
  expect(report.counters.overflow).toBe(0);
  expect(report.counters.pastDeadline).toBe(0);
  expect(report.counters.duplicates).toBe(0);
  expect(report.backlog.remaining).toBe(0);
  expect(report.backlog.drained).toBe(report.backlog.seeded);
  expect(report.baseline.withRequest.samples).toBeGreaterThan(0);
  expect(report.contended.withRequest.samples).toBeGreaterThan(0);
  expect(report.ratio.withRequestP95).toBeGreaterThan(0);
  expect(report.ratio.withRequestP95).toBeLessThan(5);
  expect(report.ratio.withRequestP99).toBeLessThan(5);
  expect(report.contended.perCompany).toEqual([
    {
      companyId: world.company,
      turns: 12,
      visits: CONTENDED_COUNT,
      settlements: {
        TERMINAL: CONTENDED_COUNT,
        ABSENT: 0,
        FUTURE_UNATTEMPTED: 0,
        RETRY: 0,
        DELEGATED: 0,
      },
    },
    {
      companyId: world.otherCompany,
      turns: 6,
      visits: CONTENDED_COUNT * 2,
      settlements: {
        TERMINAL: CONTENDED_COUNT * 2,
        ABSENT: 0,
        FUTURE_UNATTEMPTED: 0,
        RETRY: 0,
        DELEGATED: 0,
      },
    },
  ]);
  expect(
    contended.turns.filter(
      (run) => run.companyId === world.company && run.summary.end === 'ACQUIRE_BUSY',
    ).length,
  ).toBeGreaterThanOrEqual(1);
}, 900_000);
