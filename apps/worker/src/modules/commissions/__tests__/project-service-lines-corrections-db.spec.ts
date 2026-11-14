import { expect, it } from 'vitest';

import { walkCommissionStatement } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { CommissionPeriodRolledOverError } from '../domain/errors.ts';
import {
  A,
  changed,
  consumerWithClock,
  corrections,
  CURRENT,
  db,
  deliverAt,
  deliverWith,
  failingCorrectionsConsumer,
  frozenLines,
  generations,
  heads,
  ids,
  marks,
  seedClosedMonth,
  SOURCE_PERIOD,
  statementStatus,
  TARGET_PERIOD,
} from './project-service-lines-corrections-db.fixture.ts';
import { COMMISSION_LINE_IDS } from '../../../../../../packages/db/test/commission-line-fixtures.ts';

const SOURCE_REF = `line:${COMMISSION_LINE_IDS.lineA}`;

it.each(['APPROVED', 'PAID'] as const)(
  'CM-44/CM-47 cancelling a line in a $status month posts the negative correction into the next DRAFT month',
  async (status) => {
    const sourceStatementId = await seedClosedMonth({ status });
    const cancelled = changed();

    expect(await deliverAt(CURRENT, cancelled)).toEqual({ delivered: true });

    expect(await corrections()).toMatchObject([
      {
        employee_id: A.employee,
        source_period: SOURCE_PERIOD,
        target_period: TARGET_PERIOD,
        source_ref: SOURCE_REF,
        kind: 'COMMISSION',
        amount: '-10.000',
        previous_amount: '10.000',
        new_amount: '0.000',
        generation: 1,
        event_id: cancelled.id,
      },
    ]);
    expect(await generations()).toEqual([
      {
        employee_id: A.employee,
        period: SOURCE_PERIOD,
        generation: 1,
      },
    ]);
    expect(await frozenLines(sourceStatementId)).toEqual([
      {
        employee_id: A.employee,
        source_ref: SOURCE_REF,
        kind: 'COMMISSION',
        amount: '10.000',
        previous_amount: null,
        new_amount: null,
        source_period: null,
      },
    ]);
  },
);

it('CM-45 a performer change posts one negative and one positive correction', async () => {
  await seedClosedMonth({ employees: [A.employee, COMMISSION_LINE_IDS.secondEmployee] });
  const event = changed({
    changeKind: 'PERFORMERS_CHANGE',
    performers: [{ employee_id: COMMISSION_LINE_IDS.secondEmployee, share_bps: 10000 }],
  });

  expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject([
    {
      employee_id: A.employee,
      source_ref: SOURCE_REF,
      amount: '-10.000',
      previous_amount: '10.000',
      new_amount: '0.000',
      generation: 1,
    },
    {
      employee_id: COMMISSION_LINE_IDS.secondEmployee,
      source_ref: SOURCE_REF,
      amount: '10.000',
      previous_amount: '0.000',
      new_amount: '10.000',
      generation: 1,
    },
  ]);
});

it('CM-49 replay does not bump the generation and a real change posts only the new delta', async () => {
  await seedClosedMonth();
  const cancelled = changed();
  expect(await deliverAt(CURRENT, cancelled)).toEqual({ delivered: true });
  expect(await deliverAt(CURRENT, { ...cancelled })).toEqual({ delivered: true });
  expect(await corrections()).toHaveLength(1);
  expect(await generations()).toMatchObject([{ generation: 1 }]);

  const changedAgain = changed({
    revision: 3,
    status: 'ACTIVE',
    changeKind: 'PRICE_DISCOUNT_EDIT',
    net: '300.000',
  });
  expect(await deliverAt(CURRENT, changedAgain)).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject([
    { amount: '-10.000', generation: 1, event_id: cancelled.id },
    {
      amount: '15.000',
      previous_amount: '0.000',
      new_amount: '15.000',
      generation: 2,
      event_id: changedAgain.id,
    },
  ]);
  expect(await generations()).toMatchObject([{ generation: 2 }]);
  expect(await marks()).toHaveLength(3);
});

it('CM-22 a failure before correction insert rolls back the projection, generation and mark', async () => {
  await seedClosedMonth();
  const cancelled = changed();

  expect(await deliverWith(failingCorrectionsConsumer(), cancelled)).toMatchObject({
    delivered: false,
  });

  expect(await heads()).toEqual([
    {
      line_id: COMMISSION_LINE_IDS.lineA,
      revision: 1,
      status: 'ACTIVE',
      period: SOURCE_PERIOD,
    },
  ]);
  expect(await corrections()).toEqual([]);
  expect(await generations()).toEqual([]);
  expect(await marks()).toHaveLength(1);

  expect(await deliverAt(CURRENT, cancelled)).toEqual({ delivered: true });
  expect(await corrections()).toMatchObject([{ amount: '-10.000', generation: 1 }]);
  expect(await marks()).toHaveLength(2);
});

it('Q1 a month rollover throws the typed error, writes nothing and redelivery succeeds', async () => {
  await seedClosedMonth();
  const cancelled = changed();
  let reads = 0;
  const rollingClock = {
    now: () => new Date(reads++ === 0 ? '2026-12-31T20:59:00Z' : '2027-01-01T00:00:00Z'),
  };
  const failure = await db
    .withTenant(A.company, (tx) => consumerWithClock(rollingClock).handle(tx, cancelled))
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
  expect(await heads()).toMatchObject([{ revision: 1, status: 'ACTIVE' }]);
  expect(await corrections()).toEqual([]);
  expect(await generations()).toEqual([]);
  expect(await marks()).toHaveLength(1);

  expect(await deliverAt('2027-01-01T00:00:00Z', cancelled)).toEqual({ delivered: true });
  expect(await corrections()).toMatchObject([{ target_period: TARGET_PERIOD, amount: '-10.000' }]);
  expect(await marks()).toHaveLength(2);
});

it('Q2 a FOLLOW_PLAN closed month without a plan version keeps the closed-period refusal', async () => {
  await seedClosedMonth({ withPlan: false });

  expect(await deliverAt(CURRENT, changed())).toMatchObject({
    delivered: false,
    error: 'COMMISSION_PERIOD_CLOSED',
  });
  expect(await heads()).toMatchObject([{ revision: 1, status: 'ACTIVE' }]);
  expect(await corrections()).toEqual([]);
  expect(await generations()).toEqual([]);
  expect(await marks()).toHaveLength(1);
});

it('Q2 a closed month with only ZERO-rule lines delivers without a correction', async () => {
  await seedClosedMonth({
    ruleSnapshot: { kind: 'ZERO' },
    withPlan: false,
    frozenAmount: '0.000',
  });

  expect(await deliverAt(CURRENT, changed({ ruleSnapshot: { kind: 'ZERO' } }))).toEqual({
    delivered: true,
  });
  expect(await corrections()).toEqual([]);
  expect(await generations()).toMatchObject([{ generation: 1 }]);
  expect(await marks()).toHaveLength(2);
});

it('keeps the refusal when no DRAFT target month is available', async () => {
  await seedClosedMonth();
  await walkCommissionStatement(db, { tenant: A, period: TARGET_PERIOD, ids, to: 'APPROVED' });
  await walkCommissionStatement(db, { tenant: A, period: '2026-12', ids, to: 'APPROVED' });

  expect(await deliverAt(CURRENT, changed())).toMatchObject({
    delivered: false,
    error: 'COMMISSION_PERIOD_CLOSED',
  });
  expect(await heads()).toMatchObject([{ revision: 1, status: 'ACTIVE' }]);
  expect(await corrections()).toEqual([]);
  expect(await generations()).toEqual([]);
  expect(await marks()).toHaveLength(1);
});

it('CM-48 reopens an affected REVIEWED month and never selects it as the correction target', async () => {
  await seedClosedMonth();
  await walkCommissionStatement(db, { tenant: A, period: TARGET_PERIOD, ids, to: 'REVIEWED' });
  const moved = changed({
    businessDate: `${TARGET_PERIOD}-15`,
    changeKind: 'PRICE_DISCOUNT_EDIT',
  });

  expect(await deliverAt(CURRENT, moved)).toEqual({ delivered: true });

  expect(await statementStatus(TARGET_PERIOD)).toEqual([
    {
      period: TARGET_PERIOD,
      status: 'DRAFT',
      reviewed_by: null,
      reviewed_at: null,
    },
  ]);
  expect(await corrections()).toMatchObject([
    {
      source_period: SOURCE_PERIOD,
      target_period: '2026-12',
      amount: '-10.000',
    },
  ]);
  expect(await heads()).toMatchObject([{ revision: 2, period: TARGET_PERIOD }]);
});
