import { lockStatementPeriods } from '@pospay/db';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { insertCommissionLineProjection } from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { expectLockBeforeFirstWrite } from '../../../../../../packages/db/test/statement-lock-order.ts';
import { LOCK_STATEMENT_PERIODS_MARKER } from '../../../../../../packages/db/src/statement-periods.ts';
import { createCommissionPeriodRepairScope } from '../persistence/commission-period-repair-scope.ts';
import { repairCommissionPeriod } from '../use-cases/repair-commission-period/repair-commission-period.usecase.ts';
import { COMMISSION_NOW, ids } from './commission-plan-versions.fixture.ts';
import {
  correctionRows,
  flatPlan,
  NO_PLAN_REPAIR,
  repairFixture,
  seedBlockedSeptember,
  type RepairFixture,
} from './commission-period-repair.fixture.ts';

let r: RepairFixture;
beforeEach(async () => {
  r = await repairFixture();
});
afterEach(async () => {
  await r.db.close();
  await r.h.close();
});

const EARLY = ids.newId();
const LATE = ids.newId();
const body = { period: '2026-09', plan: NO_PLAN_REPAIR };
const seed = () =>
  seedBlockedSeptember(r, {
    plan: flatPlan(1000),
    planFrom: '2026-09-15',
    lines: [{ id: EARLY, date: '2026-09-10', net: '200.000' }],
    frozen: [],
  });

const waitUntilBlockedOnTheStatementLock = async (): Promise<void> => {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const [row] = await r.h.owner`SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND query LIKE ${`%${LOCK_STATEMENT_PERIODS_MARKER}%`}`;
    if ((row?.['waiting'] as number) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the repair never waited on the statement lock');
};

it('a late line that lands while the repair waits for the statement lock is read after the wait and priced', async () => {
  await seed();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holding: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    holding = resolve;
  });
  const concurrentWriter = r.db.withTenant(r.company, async (tx) => {
    await lockStatementPeriods(tx, { businessId: r.business, periods: ['2026-09'], ids });
    await insertCommissionLineProjection(tx, r.tenant, ids, {
      lineId: LATE,
      businessDate: '2026-09-12',
      occurredAt: '2026-09-12T09:00:00Z',
      recordedAt: '2026-09-12T09:00:00Z',
      period: '2026-09',
      net: '100.000',
      ruleKind: 'FOLLOW_PLAN',
      sessionId: ids.newId(),
    });
    holding();
    await gate;
  });
  await held;

  const repair = r.repair(body, 'barrier-late-line');
  await waitUntilBlockedOnTheStatementLock();
  release();
  await concurrentWriter;
  const response = await repair;

  expect(response.status).toBe(201);
  const posted = Object.fromEntries(
    (await correctionRows(r)).map((row) => [row['source_ref'], row['amount']]),
  );
  expect(posted).toEqual({ [`line:${EARLY}`]: '10.000', [`line:${LATE}`]: '5.000' });
});

it('the repair takes its one ascending lock call before the first input table is written', async () => {
  await seed();
  const actor = {
    companyId: r.company,
    userId: r.userId,
    businessId: r.business,
    employeeId: r.employee,
  };
  const clock = { now: () => COMMISSION_NOW };

  await expectLockBeforeFirstWrite({
    db: r.db,
    ownerUrl: r.h.ownerUrl,
    companyId: r.company,
    businessId: r.business,
    period: '2026-09',
    ids,
    inputTables: [
      'commission_plan_versions',
      'commission_corrections',
      'commission_period_generations',
      'commission_blocked_corrections',
    ],
    writer: (tx) =>
      repairCommissionPeriod(
        createCommissionPeriodRepairScope(tx, actor, ids, r.readers, clock),
        { ...actor, input: body, key: 'barrier-order', fingerprint: 'c'.repeat(64) },
        ids,
        clock,
      ),
  });

  expect((await correctionRows(r)).map((row) => row['source_ref'])).toEqual([`line:${EARLY}`]);
});
