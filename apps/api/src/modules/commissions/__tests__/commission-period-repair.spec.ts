import { afterEach, beforeEach, expect, it } from 'vitest';

import { ids } from './commission-plan-versions.fixture.ts';
import {
  blockRows,
  correctionRows,
  flatPlan,
  NO_PLAN_REPAIR,
  repairFixture,
  repairWrites,
  salaryPlan,
  seedBlockedSeptember,
  tieredPlan,
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

const L1 = ids.newId();
const L2 = ids.newId();
const L3 = ids.newId();
const body = { period: '2026-09', plan: NO_PLAN_REPAIR };

it('CM-52 O1: the repair posts +10.000 for the late line only and resolves the block', async () => {
  // V1 من 15 سبتمبر 10%؛ البند المتأخر L1 يوم 10 (200.000) مالوش خطة، وL2 يوم 20 (300.000) اتجمّد 30.000.
  const seeded = await seedBlockedSeptember(r, {
    plan: flatPlan(1000),
    planFrom: '2026-09-15',
    lines: [
      { id: L1, date: '2026-09-10', net: '200.000' },
      { id: L2, date: '2026-09-20', net: '300.000' },
    ],
    frozen: [{ id: L2, date: '2026-09-20', amount: '30.000' }],
  });

  const response = await r.repair(body, 'cm-52-flat');

  expect(response.status).toBe(201);
  expect(response.body['blocked_correction']).toEqual({
    id: seeded.blockId,
    code: 'NO_PLAN',
    resolved: true,
  });
  expect(response.body['version']).toMatchObject({
    version: 2,
    repair_period: '2026-09',
    effective_from: '2026-09-01',
    whole_period: false,
    created_by: r.userId,
  });
  expect(await correctionRows(r)).toEqual([
    expect.objectContaining({
      source_ref: `line:${L1}`,
      previous_amount: '0.000',
      new_amount: '10.000',
      amount: '10.000',
      event_id: seeded.firstEventId,
      source_period: '2026-09',
      target_period: '2026-10',
      target_statement_id: seeded.targetStatementId,
    }),
  ]);
  expect(await blockRows(r)).toEqual([
    expect.objectContaining({ id: seeded.blockId, resolved: true, code: 'NO_PLAN' }),
  ]);
  expect(await repairWrites(r)).toEqual([1, 1, 1, 1]);
});

it('CM-52 O2 (CS-Q47): the late line moves the tier position, so each of the three lines gains +10.000', async () => {
  // الشرائح هامشية بحد 400.000: L1 200 بخطة الإصلاح 5% = 10؛ L2 يعدّي 200→500 = 10؛ L3 500→800 = 30.
  const seeded = await seedBlockedSeptember(r, {
    plan: tieredPlan,
    planFrom: '2026-09-15',
    lines: [
      { id: L1, date: '2026-09-10', net: '200.000' },
      { id: L2, date: '2026-09-20', net: '300.000' },
      { id: L3, date: '2026-09-25', net: '300.000' },
    ],
    frozen: [
      { id: L2, date: '2026-09-20', amount: '0.000' },
      { id: L3, date: '2026-09-25', amount: '20.000' },
    ],
  });

  const response = await r.repair(body, 'cm-52-tiered');

  expect(response.status).toBe(201);
  const rows = await correctionRows(r);
  expect(Object.fromEntries(rows.map((row) => [row['source_ref'], row['amount']]))).toEqual(
    Object.fromEntries([L1, L2, L3].map((id) => [`line:${id}`, '10.000'])),
  );
  expect(rows.every((row) => row['event_id'] === seeded.firstEventId)).toBe(true);
});

it('CM-52b: a repair whose recompute then needs a missing salary flips the same row to NO_SALARY, posts nothing and keeps the version and its audit', async () => {
  // V2 بتحتاج راتباً من 15 سبتمبر وراتب هبة ناقص؛ Lb يوم 10 مالوش خطة وLa يوم 20 بـ V2.
  const seeded = await seedBlockedSeptember(r, {
    plan: salaryPlan,
    planFrom: '2026-09-15',
    lines: [
      { id: L1, date: '2026-09-10', net: '200.000' },
      { id: L2, date: '2026-09-20', net: '700.000' },
    ],
    frozen: [],
  });

  const response = await r.repair(body, 'cm-52b-flip');

  expect(response.status).toBe(201);
  expect(response.body['blocked_correction']).toEqual({
    id: seeded.blockId,
    code: 'NO_SALARY',
    resolved: false,
  });
  expect(await correctionRows(r)).toEqual([]);
  expect(await blockRows(r)).toEqual([
    expect.objectContaining({ id: seeded.blockId, code: 'NO_SALARY', resolved: false }),
  ]);
  expect((await repairWrites(r))[0]).toBe(1);
  expect((await repairWrites(r))[1]).toBe(1);

  const second = await r.repair(body, 'cm-52b-second');
  expect([second.status, second.body['code']]).toEqual([422, 'COMMISSION_REPAIR_NOT_ALLOWED']);
});

it('the repair version is listed with its repair_period and is never an ordinary version of another month', async () => {
  await seedBlockedSeptember(r, {
    plan: flatPlan(1000),
    planFrom: '2026-09-15',
    lines: [{ id: L1, date: '2026-09-10', net: '200.000' }],
    frozen: [],
  });
  await r.repair(body, 'list-after-repair');

  const listed = await r.get();

  const items = listed.body['items'] as { version: number; repair_period: string | null }[];
  expect(items.map((item) => [item.version, item.repair_period])).toEqual([
    [2, '2026-09'],
    [1, null],
  ]);
});
