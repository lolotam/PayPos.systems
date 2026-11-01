import { commissionServiceOverrideList } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { listCommissionServiceOverrides } from '../queries/commission-service-overrides.query.ts';

import { closeCommissionFixture, ids } from './commission-plan-versions.fixture.ts';
import {
  businessToday,
  commissionServiceOverridesFixture,
  overrideAndAuditCounts,
  seedOverride,
  seedOverrideService,
  shiftDate,
  statementCount,
  type CommissionServiceOverrideFixture,
} from './commission-service-overrides.fixture.ts';

let f: CommissionServiceOverrideFixture;
beforeEach(async () => {
  f = await commissionServiceOverridesFixture();
});
afterEach(async () => {
  await closeCommissionFixture(f);
});

it('the list answers with the contract shape and writes nothing', async () => {
  const today = await businessToday(f);
  const statements = await statementCount(f);
  const id = await seedOverride(f, {
    ruleKind: 'PCT',
    pctBps: 1500,
    effectiveFrom: shiftDate(today, -1),
    createdAt: `${today}T09:00:00.123456Z`,
  });
  const before = await overrideAndAuditCounts(f);
  const response = await f.getOverrides();
  expect(response.status).toBe(200);
  expect(commissionServiceOverrideList.parse(response.body)).toEqual({
    items: [
      {
        id,
        employee_id: f.employee,
        service_id: f.service,
        rule: { kind: 'PCT', value: 1500 },
        effective_from: shiftDate(today, -1),
        created_at: `${today}T09:00:00.123Z`,
        created_by: f.userId,
        is_current: true,
      },
    ],
    next_cursor: null,
  });
  expect(await overrideAndAuditCounts(f)).toEqual(before);
  // القراءة ما تفتحش شهر كشف جديد.
  expect(await statementCount(f)).toBe(statements);
});

it('the list marks one current row per service and keeps the history', async () => {
  const today = await businessToday(f);
  const old = await seedOverride(f, {
    ruleKind: 'ZERO',
    effectiveFrom: shiftDate(today, -5),
    createdAt: `${today}T08:00:00.000001Z`,
  });
  const current = await seedOverride(f, {
    ruleKind: 'PCT',
    pctBps: 500,
    effectiveFrom: shiftDate(today, -2),
    createdAt: `${today}T08:00:00.000002Z`,
  });
  const response = await f.getOverrides();
  const body = commissionServiceOverrideList.parse(response.body);
  expect(body.items.map((item) => [item.id, item.is_current])).toEqual([
    [current, true],
    [old, false],
  ]);
});

it('a missing or a deleted employee is 404 EMPLOYEE_NOT_FOUND', async () => {
  const missing = await f.getOverrides('', ids.newId());
  expect([missing.status, missing.body['code']]).toEqual([404, 'EMPLOYEE_NOT_FOUND']);
  await f.h
    .owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${f.employee}`;
  const deleted = await f.getOverrides();
  expect([deleted.status, deleted.body['code']]).toEqual([404, 'EMPLOYEE_NOT_FOUND']);
});

it('the service filter narrows the list and an unknown service gives an empty page', async () => {
  const today = await businessToday(f);
  const otherService = await seedOverrideService(f);
  await seedOverride(f, {
    serviceId: otherService,
    ruleKind: 'ZERO',
    effectiveFrom: shiftDate(today, -1),
    createdAt: `${today}T08:00:00.000001Z`,
  });
  await seedOverride(f, {
    ruleKind: 'ZERO',
    effectiveFrom: shiftDate(today, -1),
    createdAt: `${today}T08:00:00.000002Z`,
  });
  const filtered = await f.getOverrides(`?service_id=${f.service}`);
  const body = commissionServiceOverrideList.parse(filtered.body);
  expect(body.items).toHaveLength(1);
  expect(body.items[0]?.service_id).toBe(f.service);
  const unknown = await f.getOverrides(`?service_id=${ids.newId()}`);
  expect(commissionServiceOverrideList.parse(unknown.body)).toEqual({
    items: [],
    next_cursor: null,
  });
});

it('an employee without any override gets an empty page', async () => {
  const response = await f.getOverrides();
  expect(response.status).toBe(200);
  expect(commissionServiceOverrideList.parse(response.body)).toEqual({
    items: [],
    next_cursor: null,
  });
});

it('current uses the provider timezone and the transaction date, including the effective day', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    const [dates] = await tx.execute<{ east: string; west: string }>(sql`
      SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Pacific/Kiritimati','YYYY-MM-DD') AS east,
        to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Etc/GMT+12','YYYY-MM-DD') AS west`);
    if (dates === undefined) throw new Error('Missing transaction dates');
    expect(dates.east > dates.west).toBe(true);
    await tx.execute(sql`INSERT INTO commission_service_overrides(
      company_id,id,business_id,employee_id,service_id,rule_kind,effective_from,created_at,created_by)
      VALUES(${f.company},${ids.newId()},${f.business},${f.employee},${f.service},'ZERO',
        ${dates.east}::date,CURRENT_TIMESTAMP,${f.userId})`);
    const reads = f.listReaders(tx);
    const scope = {
      companyId: f.company,
      businessId: f.business,
      employeeId: f.employee,
      serviceId: undefined,
    };
    // المزود حدّ بين الوحدات؛ اختلاف اليوم ثابت مهما كانت ساعة تشغيل الاختبار، والقراءة SQL حقيقية.
    const list = (timeZone: string) =>
      listCommissionServiceOverrides(tx, { ...reads, timeZone: async () => timeZone }, scope, {
        limit: 20,
      });
    expect((await list('Pacific/Kiritimati')).items[0]?.is_current).toBe(true);
    expect((await list('Etc/GMT+12')).items[0]?.is_current).toBe(false);
  });
});
