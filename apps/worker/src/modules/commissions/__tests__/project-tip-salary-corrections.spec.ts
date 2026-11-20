import { expect, it } from 'vitest';

import {
  clockNow,
  closedOctNovDec,
  employeeA,
  FakeCorrections,
  FakeSalaryScope,
  FakeTipScope,
  frozenTip,
  monthProjection,
  projectedTip,
  salaryInput,
  salaryWorkedProjection,
  tipInput,
} from './project-tip-salary-corrections.fakes.ts';
import { ProjectSalary } from '../use-cases/project-salary/project-salary.ts';
import { ProjectSessionTips } from '../use-cases/project-session-tips/project-session-tips.ts';

const clock = { now: () => new Date(clockNow) };
const ids = { newId: () => '01920000-0000-7000-8000-00000000ffff' };

it('U1 tips: one lock call and the order targets, replaceTipSession, inserts, reopen', async () => {
  const scope = new FakeTipScope();
  scope.locked = [
    { period: '2026-10', statementId: 'statement-oct', status: 'APPROVED' },
    { period: '2026-11', statementId: 'statement-nov', status: 'DRAFT' },
    { period: '2026-12', statementId: 'statement-dec', status: 'DRAFT' },
  ];
  const corrections = new FakeCorrections(scope.calls);
  corrections.frozen = [frozenTip('CARD', 5_000n)];
  corrections.projection = monthProjection({ tips: [projectedTip('CARD', 8_000n)] });

  await new ProjectSessionTips(scope, clock, ids, corrections).execute(tipInput());

  expect(scope.lockInputs).toHaveLength(1);
  expect(scope.lockInputs[0]?.periods).toEqual(['2026-10', '2026-11', '2026-12']);
  expect(corrections.drafts).toHaveLength(1);
  expect(corrections.drafts[0]).toMatchObject({
    employeeId: employeeA,
    sourcePeriod: '2026-10',
    targetPeriod: '2026-11',
    targetStatementId: 'statement-nov',
    sourceRef: 'tip:session-a:CARD',
    kind: 'TIP_CARD',
    previousAmount: 5_000n,
    newAmount: 8_000n,
    amount: 3_000n,
    generation: 1,
    eventId: 'event-a',
  });
  expect(scope.reopenInput?.periods).toEqual([]);
  expect(scope.calls).toEqual([
    'lockSession',
    'readTipSession',
    'businessTimeZone',
    'lockPeriods',
    'replaceTipSession',
    'bumpGeneration',
    'readMonthProjection',
    'readFrozenSources',
    'readPostedCorrections',
    'insertCorrections',
    'reopenReviewed',
  ]);
});

it('U2 tips: a rollover during the lock wait writes nothing', async () => {
  const scope = new FakeTipScope();
  const corrections = new FakeCorrections(scope.calls);
  const rollingClock = {
    now: () =>
      new Date(scope.lockInputs.length === 0 ? '2026-12-31T20:59:00Z' : '2027-01-01T00:00:00Z'),
  };

  const work = new ProjectSessionTips(scope, rollingClock, ids, corrections).execute(tipInput());

  await expect(work).rejects.toMatchObject({
    code: 'COMMISSION_PERIOD_ROLLED_OVER',
    plannedPeriod: '2026-12',
    currentPeriod: '2027-01',
  });
  expect(scope.replaced).toBeNull();
  expect(scope.reopenInput).toBeUndefined();
  expect(corrections.drafts).toEqual([]);
  expect(scope.calls).toEqual(['lockSession', 'readTipSession', 'businessTimeZone', 'lockPeriods']);
});

it('U3 tips: a null event id with a closed affected month keeps the closed refusal', async () => {
  const scope = new FakeTipScope();
  scope.locked = [
    { period: '2026-10', statementId: 'statement-oct', status: 'APPROVED' },
    { period: '2026-11', statementId: 'statement-nov', status: 'DRAFT' },
    { period: '2026-12', statementId: 'statement-dec', status: 'DRAFT' },
  ];
  const corrections = new FakeCorrections(scope.calls);

  const work = new ProjectSessionTips(scope, clock, ids, corrections).execute({
    ...tipInput(),
    eventId: null,
  });

  await expect(work).rejects.toMatchObject({
    code: 'COMMISSION_PERIOD_CLOSED',
    periods: ['2026-10'],
  });
  expect(scope.replaced).toBeNull();
  expect(corrections.drafts).toEqual([]);
  expect(scope.calls).toEqual(['lockSession', 'readTipSession', 'businessTimeZone', 'lockPeriods']);
});

it('U4 tips: a null event id with open months only projects as today', async () => {
  const scope = new FakeTipScope();
  scope.locked = [
    { period: '2026-10', statementId: 'statement-oct', status: 'DRAFT' },
    { period: '2026-11', statementId: 'statement-nov', status: 'DRAFT' },
    { period: '2026-12', statementId: 'statement-dec', status: 'DRAFT' },
  ];
  const corrections = new FakeCorrections(scope.calls);

  await new ProjectSessionTips(scope, clock, ids, corrections).execute({
    ...tipInput(),
    eventId: null,
  });

  expect(scope.replaced).toMatchObject({ revision: 2, businessDate: '2026-10-01' });
  expect(corrections.drafts).toEqual([]);
  expect(corrections.bumpPeriods).toEqual([]);
  expect(scope.reopenInput?.periods).toEqual([]);
  expect(scope.calls).toEqual([
    'lockSession',
    'readTipSession',
    'businessTimeZone',
    'lockPeriods',
    'replaceTipSession',
    'reopenReviewed',
  ]);
});

it('U5 tips: a recompute without a plan keeps the closed refusal', async () => {
  const scope = new FakeTipScope();
  scope.locked = closedOctNovDec();
  const corrections = new FakeCorrections(scope.calls);
  corrections.projection = monthProjection({
    versions: [],
    lines: [
      {
        employeeId: employeeA,
        serviceId: 'service-a',
        branchId: 'branch-a',
        lineId: 'line-a',
        occurredAt: 1n,
        recordedAt: 1n,
        businessDate: '2026-10-10',
        netShare: 100_000n,
        shareBps: 10_000n,
        counts: true,
        ruleSnapshot: { kind: 'FOLLOW_PLAN' },
        status: 'ACTIVE',
      },
    ],
    tips: [projectedTip('CARD', 8_000n)],
  });

  const work = new ProjectSessionTips(scope, clock, ids, corrections).execute(tipInput());

  await expect(work).rejects.toMatchObject({
    code: 'COMMISSION_PERIOD_CLOSED',
    periods: ['2026-10'],
  });
  expect(scope.replaced).not.toBeNull();
  expect(corrections.drafts).toEqual([]);
  expect(scope.calls).toEqual([
    'lockSession',
    'readTipSession',
    'businessTimeZone',
    'lockPeriods',
    'replaceTipSession',
    'bumpGeneration',
    'readMonthProjection',
  ]);
});

it('U6 salary: one lock call over the range, one step per closed month, upsert before inserts', async () => {
  const scope = new FakeSalaryScope();
  scope.locked = closedOctNovDec();
  const corrections = new FakeCorrections(scope.calls);
  corrections.projection = salaryWorkedProjection();
  corrections.frozen = [
    {
      sourceRef: 'line:line-l2',
      kind: 'COMMISSION',
      amount: 20_000n,
      attribution: {
        sourceBranchId: 'branch-a',
        sourceBusinessDate: '2026-10-20',
        attachedBranchIds: ['branch-a'],
      },
    },
  ];

  await new ProjectSalary(scope, clock, ids, corrections).execute(salaryInput());

  expect(scope.lockInputs).toHaveLength(1);
  expect(scope.lockInputs[0]?.periods).toEqual(['2026-10', '2026-11', '2026-12']);
  expect(corrections.bumpPeriods).toEqual([
    { period: '2026-10', employeeId: employeeA },
    { period: '2026-11', employeeId: employeeA },
  ]);
  expect(corrections.drafts).toHaveLength(2);
  expect(corrections.drafts).toMatchObject([
    { sourcePeriod: '2026-10', sourceRef: 'line:line-l2', amount: -5_000n, generation: 1 },
    { sourcePeriod: '2026-11', sourceRef: 'line:line-l2', amount: -5_000n, generation: 1 },
  ]);
  expect(scope.upserted).toMatchObject({ employeeId: employeeA, amount: 550_000n, revision: 2 });
  expect(scope.reopenInput?.periods).toEqual([]);
  expect(scope.calls.indexOf('upsertSalary')).toBeLessThan(scope.calls.indexOf('bumpGeneration'));
  expect(scope.calls[scope.calls.length - 1]).toBe('reopenReviewed');
});

it('U7 salary: a rollover throws the typed error and writes nothing', async () => {
  const scope = new FakeSalaryScope();
  const corrections = new FakeCorrections(scope.calls);
  const rollingClock = {
    now: () =>
      new Date(scope.lockInputs.length === 0 ? '2026-12-31T20:59:00Z' : '2027-01-01T00:00:00Z'),
  };

  const work = new ProjectSalary(scope, rollingClock, ids, corrections).execute(salaryInput());

  await expect(work).rejects.toMatchObject({
    code: 'COMMISSION_PERIOD_ROLLED_OVER',
    plannedPeriod: '2026-12',
    currentPeriod: '2027-01',
  });
  expect(scope.upserted).toBeNull();
  expect(scope.reopenInput).toBeUndefined();
  expect(corrections.drafts).toEqual([]);
  expect(scope.calls).toEqual([
    'lockEmployee',
    'lockSalaryIdentity',
    'readSalary',
    'businessCalendar',
    'readNextEffectiveFrom',
    'lockPeriods',
  ]);
});

it('U8 salary: a closed month without a DRAFT target refuses before the upsert', async () => {
  const scope = new FakeSalaryScope();
  scope.locked = [
    { period: '2026-10', statementId: 'statement-oct', status: 'APPROVED' },
    { period: '2026-11', statementId: 'statement-nov', status: 'APPROVED' },
    { period: '2026-12', statementId: 'statement-dec', status: 'APPROVED' },
  ];
  const corrections = new FakeCorrections(scope.calls);

  const work = new ProjectSalary(scope, clock, ids, corrections).execute(salaryInput());

  await expect(work).rejects.toMatchObject({
    code: 'COMMISSION_PERIOD_CLOSED',
    periods: ['2026-10'],
  });
  expect(scope.upserted).toBeNull();
  expect(scope.reopenInput).toBeUndefined();
  expect(corrections.drafts).toEqual([]);
  expect(scope.calls).toEqual([
    'lockEmployee',
    'lockSalaryIdentity',
    'readSalary',
    'businessCalendar',
    'readNextEffectiveFrom',
    'lockPeriods',
  ]);
});
