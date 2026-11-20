import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { COMMISSION_LINE_IDS } from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { commissionSalaryEvent, commissionTipEvent } from './commission-tip-salary-events.ts';
import {
  A,
  B,
  blocks,
  corrections,
  CURRENT,
  db,
  deliver,
  deliverFailing,
  generations,
  heads,
  ids,
  linesAdded,
  marks,
  seedSeptemberNoSalary,
  seedSeptemberPlanGap,
  statementIdByPeriod,
} from './commission-blocked-corrections-db.fixture.ts';

it('K1 (CM-51) a late line in a plan-gap month is consumed with one blocked row and the held target', async () => {
  const { lateEvent } = await seedSeptemberPlanGap();

  expect(await deliver(CURRENT, lateEvent)).toEqual({ delivered: true });

  expect(await heads()).toMatchObject([
    { line_id: COMMISSION_LINE_IDS.lineA, revision: 1, status: 'ACTIVE', period: '2026-09' },
    { line_id: COMMISSION_LINE_IDS.lineB, revision: 1, status: 'ACTIVE', period: '2026-09' },
  ]);
  expect(await corrections()).toEqual([]);
  expect(await generations()).toEqual([
    { employee_id: A.employee, period: '2026-09', generation: 1 },
  ]);
  const october = await statementIdByPeriod('2026-10');
  expect(await blocks()).toMatchObject([
    {
      employee_id: A.employee,
      source_period: '2026-09',
      code: 'NO_PLAN',
      first_event_id: lateEvent.id,
      target_period: '2026-10',
      target_statement_id: october,
      resolved_at: null,
      resolved_generation: null,
    },
  ]);
  expect((await marks()).map((row) => row.event_id)).toContain(lateEvent.id);

  const unrelated = commissionTipEvent(A, ids, {
    businessDate: '2026-11-15',
    occurredAt: '2026-11-15T09:00:00.000Z',
    revision: 1,
    tips: [{ employee_id: A.employee, method: 'CARD', amount: '3.000' }],
  });
  expect(await deliver(CURRENT, unrelated)).toEqual({ delivered: true });
  expect((await marks()).map((row) => row.event_id)).toContain(unrelated.id);
});

it('K2 a second late line in the same month reuses the same blocked row untouched', async () => {
  const { lateEvent, secondLateEvent } = await seedSeptemberPlanGap();
  expect(await deliver(CURRENT, lateEvent)).toEqual({ delivered: true });
  const first = await blocks();

  expect(await deliver(CURRENT, secondLateEvent)).toEqual({ delivered: true });

  const second = await blocks();
  expect(second).toHaveLength(1);
  expect(second[0]).toMatchObject({
    id: first[0]?.id,
    code: 'NO_PLAN',
    first_event_id: lateEvent.id,
    target_period: '2026-10',
    target_statement_id: first[0]?.target_statement_id,
    resolved_at: null,
  });
});

it('K8 (CM-49) the same event delivered twice records one block with one generation', async () => {
  const { lateEvent } = await seedSeptemberPlanGap();

  expect(await deliver(CURRENT, lateEvent)).toEqual({ delivered: true });
  expect(await deliver(CURRENT, lateEvent)).toEqual({ delivered: true });

  expect(await blocks()).toHaveLength(1);
  expect(await generations()).toEqual([
    { employee_id: A.employee, period: '2026-09', generation: 1 },
  ]);
  expect(await marks()).toHaveLength(2);
});

it('K9 (CM-22) a failure at the block insert rolls back the projection, generation, block and mark', async () => {
  const { lateEvent } = await seedSeptemberPlanGap();

  expect(await deliverFailing(lateEvent)).toMatchObject({ delivered: false });

  expect(await heads()).toMatchObject([
    { line_id: COMMISSION_LINE_IDS.lineA, revision: 1, status: 'ACTIVE' },
  ]);
  expect(await heads()).toHaveLength(1);
  expect(await generations()).toEqual([]);
  expect(await blocks()).toEqual([]);
  expect(await marks()).toHaveLength(1);
});

it('K10 a resolved month can be blocked again by a later change as a second open row', async () => {
  const { lineEvent } = await seedSeptemberNoSalary('2026-09-15');
  expect(await deliver(CURRENT, lineEvent)).toEqual({ delivered: true });

  const salaryEvent = commissionSalaryEvent(A, ids, {
    effectiveFrom: '2026-09-01',
    amount: '500.000',
    revision: 1,
  });
  expect(await deliver(CURRENT, salaryEvent)).toEqual({ delivered: true });

  const earlier = linesAdded(
    [
      {
        lineId: COMMISSION_LINE_IDS.lineB,
        businessDate: '2026-09-10',
        occurredAt: '2026-09-10T09:00:00.000Z',
        net: '200.000',
        revision: 1,
        ruleSnapshot: { kind: 'FOLLOW_PLAN' },
      },
    ],
    COMMISSION_LINE_IDS.sessionA,
  );
  expect(await deliver(CURRENT, earlier)).toEqual({ delivered: true });

  const rows = await blocks();
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    code: 'NO_PLAN',
    first_event_id: earlier.id,
    target_period: '2026-10',
    resolved_at: null,
    resolved_generation: null,
  });
  expect(rows[1]).toMatchObject({
    code: 'NO_SALARY',
    first_event_id: lineEvent.id,
    resolved_generation: 2,
  });
  expect(rows[1]?.resolved_at).not.toBeNull();
});

it('X1 company B reads no blocked rows of company A', async () => {
  const { lateEvent } = await seedSeptemberPlanGap();
  expect(await deliver(CURRENT, lateEvent)).toEqual({ delivered: true });
  expect(await blocks()).toHaveLength(1);

  await db.withTenant(B.company, async (tx) => {
    const rows = await tx.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM commission_blocked_corrections`,
    );
    expect(rows[0]?.count).toBe(0);
  });
});
