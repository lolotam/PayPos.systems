import {
  CommissionBlockNoticesMissingError,
  createCommissionCorrectionScope,
  postCommissionCorrections,
  selectCommissionCorrectionTargets,
  type CommissionBlockNotices,
} from '@pospay/commissions-posting';
import { lockStatementPeriods } from '@pospay/db';
import { expect, it } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  insertCommissionLineProjection,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { noCommissionBlockNotices } from './commission-block-notice.fakes.ts';
import {
  A,
  blocks,
  corrections,
  CURRENT,
  db,
  generations,
  ids,
  seedSeptemberPlanGap,
} from './commission-blocked-corrections-db.fixture.ts';

const EVENT = '01970000-0000-7000-8000-000000000e77';

/** يزرع شهر سبتمبر المعتمد بخطة من 15 فقط، وبنداً متأخراً يوم 10 معروضاً في الإسقاط بلا خطة تسعّره. */
async function seedLateLineWithNoPlan(): Promise<void> {
  await seedSeptemberPlanGap();
  await db.withTenant(A.company, (tx) =>
    insertCommissionLineProjection(tx, A, ids, {
      lineId: COMMISSION_LINE_IDS.lineB,
      businessDate: '2026-09-10',
      occurredAt: '2026-09-10T09:00:00Z',
      recordedAt: '2026-09-10T09:00:00Z',
      period: '2026-09',
      net: '200.000',
      ruleKind: 'FOLLOW_PLAN',
    }),
  );
}

/** نفس مسار الـ worker الحقيقي: معاملة مستأجر واحدة، أقفال الشهور، ثم الخطوة بالنطاق المربوط بها. */
const runStep = (notices?: CommissionBlockNotices): Promise<void> =>
  db.withTenant(A.company, async (tx) => {
    const locked = await lockStatementPeriods(tx, {
      businessId: A.business,
      periods: ['2026-09', '2026-10'],
      ids,
    });
    await postCommissionCorrections({
      scope: createCommissionCorrectionScope(tx, ids, { now: () => new Date(CURRENT) }),
      businessId: A.business,
      companyId: A.company,
      eventId: EVENT,
      targets: selectCommissionCorrectionTargets(locked, ['2026-09'], '2026-10'),
      employees: [{ period: '2026-09', employeeId: A.employee }],
      ...(notices === undefined ? {} : { notices }),
    });
  });

it('with a notice writer the same input bumps the generation and records the block (the case the refusal guards)', async () => {
  await seedLateLineWithNoPlan();

  await runStep(noCommissionBlockNotices);

  expect(await generations()).toHaveLength(1);
  expect(await blocks()).toMatchObject([{ source_period: '2026-09', code: 'NO_PLAN' }]);
});

it('with no notice writer the refusal rolls back the generation bump of the same transaction and writes no block or correction', async () => {
  await seedLateLineWithNoPlan();
  const before = {
    blocks: await blocks(),
    corrections: await corrections(),
    generations: await generations(),
  };

  await expect(runStep()).rejects.toBeInstanceOf(CommissionBlockNoticesMissingError);

  // معاملة جديدة: الجيل اللي اترفع قبل الرفض والتوقف والتصحيحات كلها زي ما كانت قبل النداء بالظبط.
  expect(await generations()).toEqual(before.generations);
  expect(await blocks()).toEqual(before.blocks);
  expect(await corrections()).toEqual(before.corrections);
});
