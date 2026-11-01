import { afterEach, beforeEach, expect, it } from 'vitest';

import { expectLockBeforeFirstWrite } from '../../../../../../packages/db/test/statement-lock-order.ts';
import { createCommissionServiceOverrideScope } from '../persistence/commission-service-override-scope.ts';
import { writeCommissionServiceOverride } from '../use-cases/create-commission-service-override/create-commission-service-override.usecase.ts';
import { closeCommissionFixture, ids, setCommissionStatement } from './commission-plan-versions.fixture.ts';
import {
  commissionServiceOverridesFixture,
  overrideAndAuditCounts,
  overrideCommand,
  overrideInput,
  OVERRIDE_NOW,
  type CommissionServiceOverrideFixture,
} from './commission-service-overrides.fixture.ts';

let f: CommissionServiceOverrideFixture;
beforeEach(async () => {
  f = await commissionServiceOverridesFixture();
  await setCommissionStatement(f, '2026-10', 'APPROVED');
});
afterEach(async () => {
  await closeCommissionFixture(f);
});

it('CM-13 the override writer waits on the statement lock and writes no row before it', async () => {
  const before = await overrideAndAuditCounts(f);
  const command = overrideCommand(f, overrideInput(f), 'cm-13-lock-order');
  await expect(
    expectLockBeforeFirstWrite({
      db: f.db,
      ownerUrl: f.h.ownerUrl,
      companyId: f.company,
      businessId: f.business,
      period: '2026-10',
      ids,
      inputTables: ['commission_service_overrides'],
      writer: (tx) =>
        writeCommissionServiceOverride(
          createCommissionServiceOverrideScope(tx, command, ids, f.readers),
          command,
          ids,
          { now: () => OVERRIDE_NOW },
        ),
    }),
  ).rejects.toMatchObject({ code: 'COMMISSION_PERIOD_CLOSED' });
  expect(await overrideAndAuditCounts(f)).toEqual(before);
});

it.each(['2026-10', '2026-11'])(
  'CM-13 a month rollover acquires the %s lock before writing and uses the new time', async (period) => {
  const initial = new Date('2026-10-30T12:00:00.000Z');
  const advanced = new Date('2026-11-01T12:00:00.000Z');
  let samples = 0;
  const clock = { now: () => samples++ === 0 ? initial : advanced };
  const before = await overrideAndAuditCounts(f);
  const command = overrideCommand(f, overrideInput(f), 'cm-13-rollover');
  await expect(
    expectLockBeforeFirstWrite({
      db: f.db,
      ownerUrl: f.h.ownerUrl,
      companyId: f.company,
      businessId: f.business,
      period,
      ids,
      inputTables: ['commission_service_overrides'],
      writer: (tx) =>
        writeCommissionServiceOverride(
          createCommissionServiceOverrideScope(tx, command, ids, f.readers),
          command,
          ids,
          clock,
        ),
    }),
  ).rejects.toMatchObject({ code: 'COMMISSION_EFFECTIVE_FROM_PAST' });
  expect(await overrideAndAuditCounts(f)).toEqual(before);
  // الفحص يثبت الانتظار الحقيقي عند كل قفل على حدة؛ اختبار نوفمبر يفشل لو القفل الجديد اتنسى.
  // القرار اتخد بالوقت الجديد: بالتاريخ القديم كان الرد COMMISSION_PERIOD_CLOSED لأن أكتوبر APPROVED.
  const statements = await f.h.owner`SELECT period,status FROM commission_statements
    WHERE company_id=${f.company} AND business_id=${f.business} ORDER BY period`;
  expect(statements.map((row) => row['period'])).toEqual(
    period === '2026-11' ? ['2026-10', '2026-11'] : ['2026-10'],
  );
});
