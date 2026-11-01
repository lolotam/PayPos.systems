import { commissionServiceOverrideList } from '@pospay/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { closeCommissionFixture, ids } from './commission-plan-versions.fixture.ts';
import {
  businessToday,
  commissionServiceOverridesFixture,
  seedOverride,
  seedOverrideService,
  shiftDate,
  type CommissionServiceOverrideFixture,
} from './commission-service-overrides.fixture.ts';

let f: CommissionServiceOverrideFixture;
beforeEach(async () => {
  f = await commissionServiceOverridesFixture();
});
afterEach(async () => {
  await closeCommissionFixture(f);
});

async function page(
  query: string,
): Promise<ReturnType<typeof commissionServiceOverrideList.parse>> {
  const response = await f.getOverrides(query);
  expect(response.status).toBe(200);
  return commissionServiceOverrideList.parse(response.body);
}

it('the pages cover every row once, ordered by service then by the newest save', async () => {
  const today = await businessToday(f);
  // ترتيب الخدمة بالمعرّف عشان الترتيب في القائمة يبقى متوقع من غير افتراض.
  const services = [f.service, await seedOverrideService(f)].sort();
  const lowerService = services[0] as string;
  const upperService = services[1] as string;
  const first = await seedOverride(f, {
    serviceId: lowerService,
    ruleKind: 'ZERO',
    effectiveFrom: shiftDate(today, -3),
    createdAt: `${today}T09:00:00.000001Z`,
  });
  const second = await seedOverride(f, {
    serviceId: lowerService,
    ruleKind: 'ZERO',
    effectiveFrom: shiftDate(today, -3),
    createdAt: `${today}T09:00:00.000002Z`,
  });
  const third = await seedOverride(f, {
    serviceId: upperService,
    ruleKind: 'ZERO',
    effectiveFrom: shiftDate(today, -3),
    createdAt: `${today}T09:00:00.000003Z`,
  });
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const query = cursor === null ? '?limit=1' : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
    const body = await page(query);
    seen.push(...body.items.map((item) => item.id));
    cursor = body.next_cursor;
    pages += 1;
  } while (cursor !== null);
  expect(pages).toBe(3);
  expect(seen).toEqual([second, first, third]);
  expect(new Set(seen).size).toBe(seen.length);
});

it('the newest save wins even when its effective date is older', async () => {
  const today = await businessToday(f);
  const older = await seedOverride(f, {
    ruleKind: 'ZERO',
    effectiveFrom: shiftDate(today, -1),
    createdAt: `${today}T09:00:00.000001Z`,
  });
  const newer = await seedOverride(f, {
    ruleKind: 'PCT',
    pctBps: 1500,
    effectiveFrom: shiftDate(today, -9),
    createdAt: `${today}T09:00:00.000002Z`,
  });
  const body = await page('');
  expect(body.items.map((item) => [item.id, item.is_current])).toEqual([
    [newer, true],
    [older, false],
  ]);
});

it('a future override does not supersede the row that applies today', async () => {
  const today = await businessToday(f);
  const applies = await seedOverride(f, {
    ruleKind: 'ZERO',
    effectiveFrom: shiftDate(today, -1),
    createdAt: `${today}T09:00:00.000001Z`,
  });
  const future = await seedOverride(f, {
    ruleKind: 'PCT',
    pctBps: 1500,
    effectiveFrom: shiftDate(today, 30),
    createdAt: `${today}T09:00:00.000002Z`,
  });
  const body = await page('');
  expect(body.items.map((item) => [item.id, item.is_current])).toEqual([
    [future, false],
    [applies, true],
  ]);
});

it('a tie on the save time is broken by the greater id', async () => {
  const today = await businessToday(f);
  const generated = [ids.newId(), ids.newId()].sort();
  const lower = generated[0] as string;
  const higher = generated[1] as string;
  await seedOverride(f, {
    id: lower,
    ruleKind: 'ZERO',
    effectiveFrom: shiftDate(today, -1),
    createdAt: `${today}T09:00:00.123456Z`,
  });
  await seedOverride(f, {
    id: higher,
    ruleKind: 'PCT',
    pctBps: 1500,
    effectiveFrom: shiftDate(today, -1),
    createdAt: `${today}T09:00:00.123456Z`,
  });
  const body = await page('');
  expect(body.items.map((item) => [item.id, item.is_current])).toEqual([
    [higher, true],
    [lower, false],
  ]);
});

it('the current row stays current on the page that does not hold it', async () => {
  const today = await businessToday(f);
  const winner = await seedOverride(f, {
    ruleKind: 'PCT',
    pctBps: 1500,
    effectiveFrom: shiftDate(today, -1),
    createdAt: `${today}T09:00:00.000002Z`,
  });
  const loser = await seedOverride(f, {
    ruleKind: 'ZERO',
    effectiveFrom: shiftDate(today, -1),
    createdAt: `${today}T09:00:00.000001Z`,
  });
  const first = await page('?limit=1');
  expect(first.items.map((item) => [item.id, item.is_current])).toEqual([[winner, true]]);
  const second = await page(`?limit=1&cursor=${encodeURIComponent(first.next_cursor ?? '')}`);
  // المنافس الحالي في صفحة تانية، والصف الثاني لسه عارف إنه مش الحالي.
  expect(second.items.map((item) => [item.id, item.is_current])).toEqual([[loser, false]]);
});

it('two rows inside the same millisecond stay two rows across the pages', async () => {
  const today = await businessToday(f);
  const first = await seedOverride(f, {
    ruleKind: 'ZERO',
    effectiveFrom: shiftDate(today, -1),
    createdAt: `${today}T09:00:00.123001Z`,
  });
  const second = await seedOverride(f, {
    ruleKind: 'ZERO',
    effectiveFrom: shiftDate(today, -1),
    createdAt: `${today}T09:00:00.123002Z`,
  });
  const firstPage = await page('?limit=1');
  const cursor = JSON.parse(Buffer.from(firstPage.next_cursor ?? '', 'base64url').toString('utf8'));
  expect(cursor.t).toBe(`${today}T09:00:00.123002Z`);
  const secondPage = await page(
    `?limit=1&cursor=${encodeURIComponent(firstPage.next_cursor ?? '')}`,
  );
  expect(firstPage.items[0]?.created_at).toBe(`${today}T09:00:00.123Z`);
  expect(secondPage.items[0]?.created_at).toBe(`${today}T09:00:00.123Z`);
  expect([firstPage.items[0]?.id, secondPage.items[0]?.id]).toEqual([second, first]);
});
