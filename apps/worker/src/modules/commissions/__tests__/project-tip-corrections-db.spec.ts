import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  COMMISSION_LINE_TENANTS,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { walkCommissionStatement } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { CommissionPeriodRolledOverError } from '../domain/errors.ts';
import {
  A,
  blocks,
  consumerWithClock,
  corrections,
  CURRENT,
  db,
  deliverAt,
  deliverWith,
  failingTipsCorrectionsConsumer,
  generations,
  ids,
  marks,
  owner,
  seedClosedTipMonth,
  SOURCE_PERIOD,
  statementStatus,
  TARGET_PERIOD,
  tipEvent,
  tipHeads,
  tipRows,
} from './project-tip-salary-corrections-db.fixture.ts';

const B = COMMISSION_LINE_TENANTS.B;

const correctionAttributions = () =>
  owner`SELECT employee_id,source_ref,source_branch_id,
    source_business_date::text AS source_business_date, attached_branch_ids
    FROM commission_corrections ORDER BY employee_id,source_ref`;

it.each(['APPROVED', 'PAID'] as const)(
  'T1/T5 (CM-46 card, CM-47) a raised card tip in a $status month posts the copied-attribution correction',
  async (status) => {
    const { sessionId, sourceRef } = await seedClosedTipMonth({ status });
    const event = tipEvent({
      sessionId,
      businessDate: '2026-10-15',
      revision: 2,
      tips: [{ employee_id: A.employee, method: 'CARD', amount: '8.000' }],
    });

    expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });

    expect(await corrections()).toMatchObject([
      {
        employee_id: A.employee,
        source_period: '2026-10',
        target_period: '2026-11',
        source_ref: sourceRef,
        kind: 'TIP_CARD',
        amount: '3.000',
        previous_amount: '5.000',
        new_amount: '8.000',
        generation: 1,
        event_id: event.id,
      },
    ]);
    expect(await generations()).toEqual([
      { employee_id: A.employee, period: '2026-10', generation: 1 },
    ]);
    expect(await correctionAttributions()).toMatchObject([
      {
        employee_id: A.employee,
        source_ref: sourceRef,
        source_branch_id: A.branch,
        source_business_date: '2026-10-15',
        attached_branch_ids: [A.branch],
      },
    ]);
  },
);

it('T2 (CM-46, cash) a raised cash tip posts a TIP_CASH correction the same way', async () => {
  const { sessionId, sourceRef } = await seedClosedTipMonth({ method: 'CASH' });
  const event = tipEvent({
    sessionId,
    businessDate: '2026-10-15',
    revision: 2,
    tips: [{ employee_id: A.employee, method: 'CASH', amount: '8.000' }],
  });

  expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject([
    {
      source_ref: sourceRef,
      kind: 'TIP_CASH',
      amount: '3.000',
      previous_amount: '5.000',
      new_amount: '8.000',
      generation: 1,
      event_id: event.id,
    },
  ]);
});

it('T3 a tip moved to another employee posts the negative and the resolved positive', async () => {
  const { sessionId, sourceRef } = await seedClosedTipMonth();
  const event = tipEvent({
    sessionId,
    businessDate: '2026-10-15',
    revision: 2,
    tips: [{ employee_id: COMMISSION_LINE_IDS.secondEmployee, method: 'CARD', amount: '8.000' }],
  });

  expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject([
    {
      employee_id: A.employee,
      source_ref: sourceRef,
      kind: 'TIP_CARD',
      amount: '-5.000',
      previous_amount: '5.000',
      new_amount: '0.000',
      generation: 1,
    },
    {
      employee_id: COMMISSION_LINE_IDS.secondEmployee,
      source_ref: sourceRef,
      kind: 'TIP_CARD',
      amount: '8.000',
      previous_amount: '0.000',
      new_amount: '8.000',
      generation: 1,
    },
  ]);
  // موظفة بلا فترة مجمّدة تغطي التاريخ تأخذ attached_branch_ids فارغة، والفرع والتاريخ من الإسقاط.
  expect(await correctionAttributions()).toMatchObject([
    {
      employee_id: A.employee,
      source_ref: sourceRef,
      attached_branch_ids: [A.branch],
    },
    {
      employee_id: COMMISSION_LINE_IDS.secondEmployee,
      source_ref: sourceRef,
      source_branch_id: A.branch,
      source_business_date: '2026-10-15',
      attached_branch_ids: [],
    },
  ]);
});

it('T4 a session moved from a closed month to an open one posts the negative into the open month', async () => {
  const { sessionId, sourceRef } = await seedClosedTipMonth();
  const event = tipEvent({
    sessionId,
    businessDate: '2026-11-15',
    revision: 2,
    tips: [{ employee_id: A.employee, method: 'CARD', amount: '5.000' }],
  });

  expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });

  expect(await tipHeads()).toMatchObject([{ session_id: sessionId, period: '2026-11' }]);
  expect(await tipRows()).toMatchObject([{ employee_id: A.employee, amount: '5.000' }]);
  expect(await corrections()).toMatchObject([
    {
      source_period: '2026-10',
      target_period: '2026-11',
      source_ref: sourceRef,
      amount: '-5.000',
    },
  ]);
});

it('T6 (CM-49) a replayed tip event is deduped and a real change posts only the new delta', async () => {
  const { sessionId, sourceRef } = await seedClosedTipMonth();
  const raised = tipEvent({
    sessionId,
    businessDate: '2026-10-15',
    revision: 2,
    tips: [{ employee_id: A.employee, method: 'CARD', amount: '8.000' }],
  });
  expect(await deliverAt(CURRENT, raised)).toEqual({ delivered: true });
  expect(await deliverAt(CURRENT, { ...raised })).toEqual({ delivered: true });
  expect(await corrections()).toHaveLength(1);
  expect(await generations()).toMatchObject([{ generation: 1 }]);

  const raisedAgain = tipEvent({
    sessionId,
    businessDate: '2026-10-15',
    revision: 3,
    tips: [{ employee_id: A.employee, method: 'CARD', amount: '10.000' }],
  });
  expect(await deliverAt(CURRENT, raisedAgain)).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject([
    { amount: '3.000', generation: 1, event_id: raised.id },
    {
      source_ref: sourceRef,
      amount: '2.000',
      previous_amount: '8.000',
      new_amount: '10.000',
      generation: 2,
      event_id: raisedAgain.id,
    },
  ]);
  expect(await generations()).toMatchObject([{ generation: 2 }]);
});

it('T7 (CM-22) a failure at the tip correction insert rolls back the head, rows and mark', async () => {
  const { sessionId } = await seedClosedTipMonth();
  const event = tipEvent({
    sessionId,
    businessDate: '2026-10-15',
    revision: 2,
    tips: [{ employee_id: A.employee, method: 'CARD', amount: '8.000' }],
  });

  expect(await deliverWith(failingTipsCorrectionsConsumer(), event)).toMatchObject({
    delivered: false,
  });

  expect(await tipHeads()).toMatchObject([{ session_id: sessionId, revision: 1 }]);
  expect(await tipRows()).toMatchObject([{ employee_id: A.employee, amount: '5.000' }]);
  expect(await corrections()).toEqual([]);
  expect(await generations()).toEqual([]);
  expect(await marks()).toHaveLength(1);

  expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });
  expect(await corrections()).toMatchObject([{ amount: '3.000', generation: 1 }]);
  expect(await marks()).toHaveLength(2);
});

it('T8 (Q1) a rollover throws the typed error, writes nothing and redelivery succeeds', async () => {
  const { sessionId } = await seedClosedTipMonth();
  const event = tipEvent({
    sessionId,
    businessDate: '2026-10-15',
    revision: 2,
    tips: [{ employee_id: A.employee, method: 'CARD', amount: '8.000' }],
  });
  let reads = 0;
  const rollingClock = {
    now: () => new Date(reads++ === 0 ? '2026-12-31T20:59:00Z' : '2027-01-01T00:00:00Z'),
  };
  const failure = await db
    .withTenant(A.company, (tx) => consumerWithClock(rollingClock).handle(tx, event))
    .then(
      () => null,
      (error: unknown) => error,
    );

  expect(failure).toBeInstanceOf(CommissionPeriodRolledOverError);
  expect(failure).toMatchObject({
    code: 'COMMISSION_PERIOD_ROLLED_OVER',
    plannedPeriod: '2026-12',
    currentPeriod: '2027-01',
  });
  expect(await tipHeads()).toMatchObject([{ session_id: sessionId, revision: 1 }]);
  expect(await corrections()).toEqual([]);
  expect(await generations()).toEqual([]);
  expect(await marks()).toHaveLength(1);

  expect(await deliverAt('2027-01-01T00:00:00Z', event)).toEqual({ delivered: true });
  expect(await corrections()).toMatchObject([{ target_period: '2026-11', amount: '3.000' }]);
  expect(await marks()).toHaveLength(2);
});

it('T9 (CM-48 shape) an affected REVIEWED month is never the target and returns to DRAFT', async () => {
  const { sessionId, sourceRef } = await seedClosedTipMonth({ period: '2026-09' });
  await walkCommissionStatement(db, { tenant: A, period: '2026-10', ids, to: 'REVIEWED' });
  const event = tipEvent({
    sessionId,
    businessDate: '2026-10-15',
    revision: 2,
    tips: [{ employee_id: A.employee, method: 'CARD', amount: '8.000' }],
  });

  expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });

  expect(await statementStatus('2026-10')).toMatchObject([{ status: 'DRAFT' }]);
  // الجلسة انتقلت من سبتمبر: صفها المجمّد يعود صفراً فيسبق التصحيح سالباً.
  expect(await corrections()).toMatchObject([
    {
      source_period: '2026-09',
      target_period: '2026-11',
      source_ref: sourceRef,
      amount: '-5.000',
      previous_amount: '5.000',
      new_amount: '0.000',
    },
  ]);
  expect(await generations()).toEqual([
    { employee_id: A.employee, period: '2026-09', generation: 1 },
  ]);
});

it('T10 keeps the refusal when no DRAFT target month is available', async () => {
  const { sessionId } = await seedClosedTipMonth();
  await walkCommissionStatement(db, { tenant: A, period: '2026-11', ids, to: 'APPROVED' });
  await walkCommissionStatement(db, { tenant: A, period: '2026-12', ids, to: 'APPROVED' });
  const event = tipEvent({
    sessionId,
    businessDate: '2026-10-15',
    revision: 2,
    tips: [{ employee_id: A.employee, method: 'CARD', amount: '8.000' }],
  });

  expect(await deliverAt(CURRENT, event)).toMatchObject({
    delivered: false,
    error: 'Error:COMMISSION_PERIOD_CLOSED',
  });
  expect(await tipHeads()).toMatchObject([{ session_id: sessionId, revision: 1 }]);
  expect(await corrections()).toEqual([]);
  expect(await generations()).toEqual([]);
  expect(await marks()).toHaveLength(1);
});

it('T11 (Q2) a closed month with a FOLLOW_PLAN line and no plan version is consumed with one open blocked row', async () => {
  const { sessionId } = await seedClosedTipMonth({ withPlan: false, withLine: true });
  const event = tipEvent({
    sessionId,
    businessDate: '2026-10-15',
    revision: 2,
    tips: [{ employee_id: A.employee, method: 'CARD', amount: '8.000' }],
  });

  expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });
  expect(await tipHeads()).toMatchObject([{ session_id: sessionId, revision: 2 }]);
  expect(await corrections()).toEqual([]);
  expect(await generations()).toEqual([
    { employee_id: A.employee, period: SOURCE_PERIOD, generation: 1 },
  ]);
  expect(await blocks()).toMatchObject([
    {
      employee_id: A.employee,
      source_period: SOURCE_PERIOD,
      code: 'NO_PLAN',
      first_event_id: event.id,
      target_period: TARGET_PERIOD,
      resolved_at: null,
      resolved_generation: null,
    },
  ]);
  expect(await marks()).toHaveLength(2);
});

it('X1 after the tip correction the correction and generation tables read empty as company B', async () => {
  const { sessionId } = await seedClosedTipMonth();
  const event = tipEvent({
    sessionId,
    businessDate: '2026-10-15',
    revision: 2,
    tips: [{ employee_id: A.employee, method: 'CARD', amount: '8.000' }],
  });
  expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });
  expect(await corrections()).toHaveLength(1);

  await db.withTenant(B.company, async (tx) => {
    const correctionRows = await tx.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM commission_corrections`,
    );
    const generationRows = await tx.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM commission_period_generations`,
    );
    expect(correctionRows[0]?.count).toBe(0);
    expect(generationRows[0]?.count).toBe(0);
  });
});
