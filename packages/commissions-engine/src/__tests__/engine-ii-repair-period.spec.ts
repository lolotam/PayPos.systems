import { expect, it } from 'vitest';

import { selectCommissionPlanVersion } from '../plan-version.ts';
import { version } from './engine-ii-fixtures.ts';

/** خطة إصلاح لشهر محدد؛ سريانها الأول من أول الشهر كما يكتبها القارئ (Q2 من الخطة). */
const repair = (patch: Partial<Parameters<typeof version>[0]> = {}): ReturnType<typeof version> =>
  version({
    effectiveFrom: '2026-09-01',
    wholePeriod: false,
    repairPeriod: '2026-09',
    ...patch,
  });

it('E1 a repair version applies in its month when no ordinary version applies', () => {
  const late = repair();
  // البند يوم 10 سبتمبر قبل أول إصدار عادي؛ خطة إصلاح سبتمبر هي الوحيدة الأهلة.
  expect(selectCommissionPlanVersion('employee-a', '2026-09-10', [late])).toBe(late);
});

it('E2 an ordinary version keeps the line even when the repair version is newer', () => {
  const ordinary = version({ effectiveFrom: '2026-09-15' });
  const newerRepair = repair({ createdAt: 2n, version: 2n });
  expect(selectCommissionPlanVersion('employee-a', '2026-09-20', [newerRepair, ordinary])).toBe(
    ordinary,
  );
});

it('E3 a date in the month after the repair month ignores the repair version', () => {
  expect(selectCommissionPlanVersion('employee-a', '2026-10-05', [repair()])).toBeNull();
});

it('E4 a date in the month before the repair month ignores the repair version', () => {
  // سريان الإصلاح قبل تاريخ أغسطس نفسه، فشرط الشهر هو الوحيد اللي يرفضه هنا.
  expect(
    selectCommissionPlanVersion('employee-a', '2026-08-31', [
      repair({ effectiveFrom: '2026-08-01' }),
    ]),
  ).toBeNull();
});

it('E5 a repair version dated earlier never wins the ordinary pass', () => {
  const ordinary = version({ effectiveFrom: '2026-09-15' });
  const earlierRepair = repair();
  // تاريخ سريان الإصلاح أقدم (1 سبتمبر) لكن البند يوم 20 له إصدار عادي يفوز أولاً.
  expect(selectCommissionPlanVersion('employee-a', '2026-09-20', [earlierRepair, ordinary])).toBe(
    ordinary,
  );
});

it('E6 two repair versions of the same month tie-break by createdAt then version', () => {
  const older = repair({ createdAt: 1n, version: 1n });
  const newer = repair({ createdAt: 3n, version: 2n });
  expect(selectCommissionPlanVersion('employee-a', '2026-09-12', [newer, older])).toBe(newer);
  const tiedLower = repair({ createdAt: 5n, version: 1n });
  const tiedHigher = repair({ createdAt: 5n, version: 2n });
  expect(selectCommissionPlanVersion('employee-a', '2026-09-12', [tiedHigher, tiedLower])).toBe(
    tiedHigher,
  );
});

it('E7 a whole-period ordinary version of the month covers every day, so the repair version is never selected', () => {
  const whole = version({ effectiveFrom: '2026-09-20', wholePeriod: true });
  const newerRepair = repair({ createdAt: 2n, version: 2n });
  expect(selectCommissionPlanVersion('employee-a', '2026-09-10', [newerRepair, whole])).toBe(whole);
});

it('E8 a repair version of another employee is ignored', () => {
  const otherEmployee = repair({ employeeId: 'employee-b' });
  expect(selectCommissionPlanVersion('employee-a', '2026-09-10', [otherEmployee])).toBeNull();
});

it('E9 a repair version covers a plan-less day earlier in its month than its own effectiveFrom', () => {
  // الربط بين سريان الإصلاح وأول شهره شرط قاعدة بيانات بينزل في 55-2b؛ في المحرك شهر الإصلاح هو الفيصل.
  const midMonthRepair = repair({ effectiveFrom: '2026-09-15' });
  expect(selectCommissionPlanVersion('employee-a', '2026-09-10', [midMonthRepair])).toBe(
    midMonthRepair,
  );
});
