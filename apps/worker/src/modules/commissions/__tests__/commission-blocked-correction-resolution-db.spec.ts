import { expect, it } from 'vitest';

import { COMMISSION_LINE_IDS } from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { walkCommissionStatement } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { commissionSalaryEvent, commissionTipEvent } from './commission-tip-salary-events.ts';
import {
  A,
  approveClosed,
  blocks,
  corrections,
  CURRENT,
  db,
  deliver,
  generations,
  ids,
  linesAdded,
  reopenDraft,
  salaryRows,
  seedLineSession,
  seedPlan,
  seedSeptemberNoSalary,
  statementIdByPeriod,
  tipHeads,
  SALARY_THRESHOLD_PLAN,
} from './commission-blocked-corrections-db.fixture.ts';

const resolvingSalary = () =>
  commissionSalaryEvent(A, ids, {
    effectiveFrom: '2026-09-01',
    amount: '500.000',
    revision: 1,
  });

it('K3 (CM-53) the resolving salary posts the O3 oracle amount and resolves the block', async () => {
  const { lineEvent, lineRef } = await seedSeptemberNoSalary('2025-06-01');

  expect(await deliver(CURRENT, lineEvent)).toEqual({ delivered: true });
  expect(await blocks()).toMatchObject([
    {
      source_period: '2026-09',
      code: 'NO_SALARY',
      first_event_id: lineEvent.id,
      target_period: '2026-10',
      resolved_at: null,
    },
  ]);

  const salaryEvent = resolvingSalary();
  expect(await deliver(CURRENT, salaryEvent)).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject([
    {
      employee_id: A.employee,
      source_period: '2026-09',
      target_period: '2026-10',
      source_ref: lineRef,
      kind: 'COMMISSION',
      amount: '20.000',
      previous_amount: '0.000',
      new_amount: '20.000',
      generation: 2,
      event_id: salaryEvent.id,
    },
  ]);
  expect(await blocks()).toMatchObject([
    { source_period: '2026-09', code: 'NO_SALARY', resolved_generation: 2 },
  ]);
  expect(await blocks()).toMatchObject([{ resolved_at: expect.any(Date) }]);
  expect(await generations()).toEqual([
    { employee_id: A.employee, period: '2026-09', generation: 2 },
  ]);
  expect(await salaryRows()).toMatchObject([{ amount: '500.000', revision: 1 }]);
});

it('K4 (CM-52c) the earlier line flips the code to NO_PLAN and the salary keeps it there', async () => {
  const { lineEvent } = await seedSeptemberNoSalary('2026-09-15');

  expect(await deliver(CURRENT, lineEvent)).toEqual({ delivered: true });
  expect(await blocks()).toMatchObject([{ code: 'NO_SALARY', resolved_at: null }]);

  const moveEvent = linesAdded(
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
  expect(await deliver(CURRENT, moveEvent)).toEqual({ delivered: true });
  expect(await blocks()).toMatchObject([{ code: 'NO_PLAN', resolved_at: null }]);
  expect(await corrections()).toEqual([]);

  const salaryEvent = resolvingSalary();
  expect(await deliver(CURRENT, salaryEvent)).toEqual({ delivered: true });

  expect(await blocks()).toMatchObject([{ code: 'NO_PLAN', resolved_at: null }]);
  expect(await corrections()).toEqual([]);
  expect(await salaryRows()).toMatchObject([{ amount: '500.000', revision: 1 }]);
});

it('K5 (CM-53b) the resolution posts into the DRAFT month chosen at posting time, not the stored target', async () => {
  const { lineEvent } = await seedSeptemberNoSalary('2025-06-01');
  await walkCommissionStatement(db, { tenant: A, period: '2026-10', ids, to: 'REVIEWED' });

  expect(await deliver(CURRENT, lineEvent)).toEqual({ delivered: true });
  const november = await statementIdByPeriod('2026-11');
  expect(await blocks()).toMatchObject([
    { code: 'NO_SALARY', target_period: '2026-11', target_statement_id: november },
  ]);

  await reopenDraft('2026-10');

  const salaryEvent = resolvingSalary();
  expect(await deliver(CURRENT, salaryEvent)).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject([
    { source_period: '2026-09', target_period: '2026-10', amount: '20.000' },
  ]);
  expect(await blocks()).toMatchObject([
    { code: 'NO_SALARY', target_period: '2026-11', resolved_generation: 2 },
  ]);
});

it('K5b with October APPROVED the correction goes to November and the October step posts no row', async () => {
  const { lineEvent } = await seedSeptemberNoSalary('2025-06-01');
  await approveClosed('2026-10');

  expect(await deliver(CURRENT, lineEvent)).toEqual({ delivered: true });
  const november = await statementIdByPeriod('2026-11');
  expect(await blocks()).toMatchObject([
    { code: 'NO_SALARY', target_period: '2026-11', target_statement_id: november },
  ]);

  const salaryEvent = resolvingSalary();
  expect(await deliver(CURRENT, salaryEvent)).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject([
    { source_period: '2026-09', target_period: '2026-11', amount: '20.000' },
  ]);
  expect(await corrections()).toHaveLength(1);
  expect(await blocks()).toMatchObject([
    { code: 'NO_SALARY', target_period: '2026-11', resolved_generation: 2 },
  ]);
  expect(await generations()).toEqual([
    { employee_id: A.employee, period: '2026-09', generation: 2 },
    { employee_id: A.employee, period: '2026-10', generation: 1 },
  ]);
});

it('K6 the tip event keeps the block with no TIP row and the resolution posts the tip and the line together', async () => {
  await seedPlan('2025-06-01', SALARY_THRESHOLD_PLAN);
  const tipSession = ids.newId();
  const tipInitial = commissionTipEvent(A, ids, {
    sessionId: tipSession,
    businessDate: '2026-09-15',
    occurredAt: '2026-09-15T09:00:00.000Z',
    revision: 1,
    tips: [{ employee_id: A.employee, method: 'CARD', amount: '5.000' }],
  });
  expect(await deliver(CURRENT, tipInitial)).toEqual({ delivered: true });
  await seedLineSession('2026-09', 20, '700.000');
  await approveClosed('2026-09', [
    {
      kind: 'TIP_CARD',
      sourceRef: `tip:${tipSession}:CARD`,
      amount: '5.000',
      sourceBusinessDate: '2026-09-15',
    },
  ]);

  const tipEvent = commissionTipEvent(A, ids, {
    sessionId: tipSession,
    businessDate: '2026-09-15',
    occurredAt: '2026-09-15T09:00:00.000Z',
    revision: 2,
    tips: [{ employee_id: A.employee, method: 'CARD', amount: '8.000' }],
  });
  expect(await deliver(CURRENT, tipEvent)).toEqual({ delivered: true });

  expect(await tipHeads()).toMatchObject([
    { session_id: tipSession, revision: 2, period: '2026-09' },
  ]);
  expect(await corrections()).toEqual([]);
  expect(await blocks()).toMatchObject([
    { code: 'NO_SALARY', first_event_id: tipEvent.id, target_period: '2026-10' },
  ]);

  const salaryEvent = resolvingSalary();
  expect(await deliver(CURRENT, salaryEvent)).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject([
    {
      source_ref: `line:${COMMISSION_LINE_IDS.lineA}`,
      kind: 'COMMISSION',
      amount: '20.000',
      target_period: '2026-10',
    },
    {
      source_ref: `tip:${tipSession}:CARD`,
      kind: 'TIP_CARD',
      amount: '3.000',
      target_period: '2026-10',
    },
  ]);
  expect(await blocks()).toMatchObject([{ code: 'NO_SALARY', resolved_generation: 2 }]);
});

it('K7 a salary over two closed months posts the plan month and records the plan-gap month', async () => {
  // الخطة من 15 سبتمبر: بند 10 سبتمبر قبلها (NO_PLAN) وبند 20 أكتوبر بعدها (يتسعّر).
  // الأشهر في الحرفي (أغسطس/سبتمبر) غير قابلة للبناء: إصدار يغطي الشهر الأسبق يغطي ما بعده دائماً.
  const septemberLine = ids.newId();
  const octoberLine = ids.newId();
  await seedLineSession('2026-09', 10, '700.000', septemberLine);
  await seedPlan('2026-09-15', SALARY_THRESHOLD_PLAN);
  await seedLineSession('2026-10', 20, '700.000', octoberLine);
  await approveClosed('2026-09');
  await approveClosed('2026-10', [
    {
      kind: 'COMMISSION',
      lineId: octoberLine,
      sourceRef: `line:${octoberLine}`,
      amount: '20.000',
      sourceBusinessDate: '2026-10-20',
    },
  ]);

  const salaryEvent = commissionSalaryEvent(A, ids, {
    effectiveFrom: '2026-09-01',
    amount: '550.000',
    revision: 2,
  });
  expect(await deliver(CURRENT, salaryEvent)).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject([
    {
      source_period: '2026-10',
      target_period: '2026-11',
      source_ref: `line:${octoberLine}`,
      amount: '-5.000',
      previous_amount: '20.000',
      new_amount: '15.000',
      generation: 1,
    },
  ]);
  expect(await blocks()).toMatchObject([
    {
      source_period: '2026-09',
      code: 'NO_PLAN',
      first_event_id: salaryEvent.id,
      target_period: '2026-11',
      resolved_at: null,
    },
  ]);
  expect(await salaryRows()).toMatchObject([
    { effective_from: '2026-09-01', amount: '550.000', revision: 2 },
  ]);
  expect(await generations()).toEqual([
    { employee_id: A.employee, period: '2026-09', generation: 1 },
    { employee_id: A.employee, period: '2026-10', generation: 1 },
  ]);
});
