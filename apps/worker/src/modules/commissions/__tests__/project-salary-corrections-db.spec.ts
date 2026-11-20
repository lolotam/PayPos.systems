import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { COMMISSION_LINE_TENANTS } from '../../../../../../packages/db/test/commission-line-fixtures.ts';
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
  failingSalaryCorrectionsConsumer,
  generations,
  ids,
  insertCommissionSalary,
  marks,
  salaryEvent,
  salaryRows,
  seedSalaryThresholdSetup,
  seedSalaryWorkedMonth,
  statementStatus,
} from './project-tip-salary-corrections-db.fixture.ts';

const B = COMMISSION_LINE_TENANTS.B;

const backDatedEntry = (amount: string, revision = 1) =>
  salaryEvent({ effectiveFrom: '2026-01-15', amount, revision });

it('S1 (CM-46b) a back-dated entry corrects January and February into April and reopens March', async () => {
  await seedSalaryThresholdSetup();
  const january = await seedSalaryWorkedMonth('2026-01');
  const february = await seedSalaryWorkedMonth('2026-02');
  await walkCommissionStatement(db, { tenant: A, period: '2026-03', ids, to: 'REVIEWED' });

  expect(await deliverAt(CURRENT, backDatedEntry('550.000'))).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject([
    {
      employee_id: A.employee,
      source_period: '2026-01',
      target_period: '2026-04',
      source_ref: january.sourceRef,
      kind: 'COMMISSION',
      amount: '-5.000',
      previous_amount: '20.000',
      new_amount: '15.000',
      generation: 1,
    },
    {
      employee_id: A.employee,
      source_period: '2026-02',
      target_period: '2026-04',
      source_ref: february.sourceRef,
      kind: 'COMMISSION',
      amount: '-5.000',
      previous_amount: '20.000',
      new_amount: '15.000',
      generation: 1,
    },
  ]);
  const sourcePeriods = (await corrections()).map((row) => row.source_period);
  expect(sourcePeriods).not.toContain('2026-04');
  expect(await statementStatus('2026-03')).toMatchObject([{ status: 'DRAFT' }]);
  expect(await salaryRows()).toMatchObject([
    { employee_id: A.employee, effective_from: '2026-01-01', amount: '500.000', revision: 1 },
    { employee_id: A.employee, effective_from: '2026-01-15', amount: '550.000', revision: 1 },
    { employee_id: A.employee, effective_from: '2026-04-10', amount: '600.000', revision: 1 },
  ]);
  expect(await generations()).toEqual([
    { employee_id: A.employee, period: '2026-01', generation: 1 },
    { employee_id: A.employee, period: '2026-02', generation: 1 },
  ]);
});

it('S2 (CM-46b) the revised entry posts generation 2 with only the new delta', async () => {
  await seedSalaryThresholdSetup();
  const january = await seedSalaryWorkedMonth('2026-01');
  const february = await seedSalaryWorkedMonth('2026-02');
  await walkCommissionStatement(db, { tenant: A, period: '2026-03', ids, to: 'REVIEWED' });
  expect(await deliverAt(CURRENT, backDatedEntry('550.000'))).toEqual({ delivered: true });

  expect(await deliverAt(CURRENT, backDatedEntry('560.000', 2))).toEqual({ delivered: true });

  const rows = await corrections();
  expect(rows).toHaveLength(4);
  // الشهر الهدف في الجيل الثاني هو مارس: التسليم الأول أعاد فتح مارس فصار أقرب DRAFT.
  expect(rows.slice(2)).toMatchObject([
    {
      source_period: '2026-01',
      target_period: '2026-03',
      source_ref: january.sourceRef,
      amount: '-1.000',
      previous_amount: '15.000',
      new_amount: '14.000',
      generation: 2,
    },
    {
      source_period: '2026-02',
      target_period: '2026-03',
      source_ref: february.sourceRef,
      amount: '-1.000',
      previous_amount: '15.000',
      new_amount: '14.000',
      generation: 2,
    },
  ]);
  expect(await generations()).toMatchObject([
    { period: '2026-01', generation: 2 },
    { period: '2026-02', generation: 2 },
  ]);
});

it('S3 (CM-46) one APPROVED month gets exactly one L2 correction and never an L1 row', async () => {
  await seedSalaryThresholdSetup();
  const { sourceRef } = await seedSalaryWorkedMonth('2026-01');
  const event = salaryEvent({ effectiveFrom: '2026-01-01', amount: '550.000', revision: 2 });

  expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject([
    {
      source_period: '2026-01',
      target_period: '2026-02',
      source_ref: sourceRef,
      kind: 'COMMISSION',
      amount: '-5.000',
      previous_amount: '20.000',
      new_amount: '15.000',
      generation: 1,
    },
  ]);
  const sourceRefs = (await corrections()).map((row) => row.source_ref);
  expect(sourceRefs).toHaveLength(1);
  expect(await salaryRows()).toMatchObject([
    { effective_from: '2026-01-01', amount: '550.000', revision: 2 },
    { effective_from: '2026-04-10', amount: '600.000', revision: 1 },
  ]);
});

it('S4 a closed month without lines in the range is consumed with a generation and no rows', async () => {
  await seedSalaryThresholdSetup();
  const { sourceRef } = await seedSalaryWorkedMonth('2026-01');
  await walkCommissionStatement(db, { tenant: A, period: '2026-02', ids, to: 'APPROVED' });
  const event = salaryEvent({ effectiveFrom: '2026-01-01', amount: '550.000', revision: 2 });

  expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject([
    { source_period: '2026-01', target_period: '2026-03', source_ref: sourceRef, amount: '-5.000' },
  ]);
  expect(await generations()).toMatchObject([
    { period: '2026-01', generation: 1 },
    { period: '2026-02', generation: 1 },
  ]);
});

it.each(['APPROVED', 'PAID'] as const)(
  'S3/S5 (CM-46, CM-47) a $status month behaves the same for the salary correction',
  async (status) => {
    await seedSalaryThresholdSetup();
    await seedSalaryWorkedMonth('2026-01', status);
    const event = salaryEvent({ effectiveFrom: '2026-01-01', amount: '550.000', revision: 2 });

    expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });

    expect(await corrections()).toMatchObject([
      { source_period: '2026-01', target_period: '2026-02', amount: '-5.000', generation: 1 },
    ]);
  },
);

it('S6 (CM-49) a replayed salary event does not post a second generation', async () => {
  await seedSalaryThresholdSetup();
  await seedSalaryWorkedMonth('2026-01');
  const event = salaryEvent({ effectiveFrom: '2026-01-01', amount: '550.000', revision: 2 });

  expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });
  expect(await deliverAt(CURRENT, { ...event })).toEqual({ delivered: true });

  expect(await corrections()).toHaveLength(1);
  expect(await generations()).toEqual([
    { employee_id: A.employee, period: '2026-01', generation: 1 },
  ]);
});

it('S7 (CM-22) a failure at the salary correction insert rolls back the salary row and mark', async () => {
  await seedSalaryThresholdSetup();
  await seedSalaryWorkedMonth('2026-01');
  const event = salaryEvent({ effectiveFrom: '2026-01-01', amount: '550.000', revision: 2 });

  expect(await deliverWith(failingSalaryCorrectionsConsumer(), event)).toMatchObject({
    delivered: false,
  });

  expect(await salaryRows()).toHaveLength(2);
  expect(await corrections()).toEqual([]);
  expect(await generations()).toEqual([]);
  expect(await marks()).toHaveLength(0);

  expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });
  expect(await corrections()).toMatchObject([{ amount: '-5.000', generation: 1 }]);
  expect(await salaryRows()).toMatchObject([
    { effective_from: '2026-01-01', amount: '550.000', revision: 2 },
    { effective_from: '2026-04-10', amount: '600.000', revision: 1 },
  ]);
  expect(await marks()).toHaveLength(1);
});

it('S8 (Q1) a rollover throws the typed error, writes nothing and redelivery succeeds', async () => {
  await seedSalaryThresholdSetup();
  await seedSalaryWorkedMonth('2026-01');
  const event = salaryEvent({ effectiveFrom: '2026-01-01', amount: '550.000', revision: 2 });
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
  expect(await salaryRows()).toHaveLength(2);
  expect(await corrections()).toEqual([]);
  expect(await generations()).toEqual([]);
  expect(await marks()).toHaveLength(0);

  expect(await deliverAt('2027-01-01T00:00:00Z', event)).toEqual({ delivered: true });
  expect(await corrections()).toMatchObject([{ source_period: '2026-01', amount: '-5.000' }]);
  expect(await marks()).toHaveLength(1);
});

it('S9 (Q2) a NO_PLAN closed month records its block and the salary row is still written', async () => {
  await insertCommissionSalary(A.employee, '2026-01-01', '500.000');
  await insertCommissionSalary(A.employee, '2026-04-10', '600.000');
  await seedSalaryWorkedMonth('2026-01');
  await seedSalaryWorkedMonth('2026-02');
  const event = salaryEvent({ effectiveFrom: '2026-01-01', amount: '550.000', revision: 2 });

  expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });

  expect(await salaryRows()).toMatchObject([
    { effective_from: '2026-01-01', amount: '550.000', revision: 2 },
    { effective_from: '2026-04-10', amount: '600.000', revision: 1 },
  ]);
  expect(await corrections()).toEqual([]);
  expect(await generations()).toEqual([
    { employee_id: A.employee, period: '2026-01', generation: 1 },
    { employee_id: A.employee, period: '2026-02', generation: 1 },
  ]);
  expect(await blocks()).toMatchObject([
    {
      employee_id: A.employee,
      source_period: '2026-01',
      code: 'NO_PLAN',
      first_event_id: event.id,
      target_period: '2026-03',
      resolved_at: null,
      resolved_generation: null,
    },
    {
      employee_id: A.employee,
      source_period: '2026-02',
      code: 'NO_PLAN',
      first_event_id: event.id,
      target_period: '2026-03',
      resolved_at: null,
      resolved_generation: null,
    },
  ]);
  expect(await marks()).toHaveLength(1);
});

it('S10 (FR-018b) a legacy event without a business id resolves the business and posts', async () => {
  await seedSalaryThresholdSetup();
  await seedSalaryWorkedMonth('2026-01');
  const event = salaryEvent({
    businessId: null,
    effectiveFrom: '2026-01-01',
    amount: '550.000',
    revision: 2,
  });

  expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject([
    { source_period: '2026-01', target_period: '2026-02', amount: '-5.000', generation: 1 },
  ]);
  expect(await salaryRows()).toMatchObject([
    { effective_from: '2026-01-01', amount: '550.000', revision: 2 },
    { effective_from: '2026-04-10', amount: '600.000', revision: 1 },
  ]);
});

it('X1 after the salary correction the correction and generation tables read empty as company B', async () => {
  await seedSalaryThresholdSetup();
  await seedSalaryWorkedMonth('2026-01');
  const event = salaryEvent({ effectiveFrom: '2026-01-01', amount: '550.000', revision: 2 });
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
