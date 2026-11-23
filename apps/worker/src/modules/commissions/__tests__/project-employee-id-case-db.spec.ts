import type { SessionTipsChanged } from '@pospay/contracts';
import { createCommissionCorrectionScope } from '@pospay/commissions-posting';
import { expect, it } from 'vitest';

import { walkCommissionStatement } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { noCommissionBlockNotices } from './commission-block-notice.fakes.ts';
import { createCommissionTipProjectionScope } from '../persistence/commission-tip-salary-projection.scope.ts';
import {
  normalizeSessionTipsEvent,
  ProjectSessionTips,
} from '../use-cases/project-session-tips/project-session-tips.ts';
import {
  A,
  businessTimeZone,
  corrections,
  CURRENT,
  db,
  deliverAt,
  generations,
  ids,
  salaryEvent,
  seedClosedTipMonth,
  seedSalaryThresholdSetup,
  seedSalaryWorkedMonth,
  tipEvent,
} from './project-tip-salary-corrections-db.fixture.ts';

const alternating = (id: string): string =>
  [...id].map((char, index) => (index % 2 === 0 ? char.toUpperCase() : char)).join('');

/** الحالة الصغيرة هي الشاهد؛ الباقي نفس الهوية بحالة أحرف مختلفة ولازم يطلع منه نفس التصحيح بالظبط. */
const VARIANTS = [
  ['lower-case (control)', (id: string) => id],
  ['upper-case', (id: string) => id.toUpperCase()],
  ['mixed-case', alternating],
] as const;

it.each(VARIANTS)(
  'real event path (handler, normalizer, correction): a back-dated salary event with a %s employee id posts the same two -5.000 corrections in one generation',
  async (name, variant) => {
    const employeeId = variant(A.employee);
    expect(employeeId === A.employee).toBe(name.includes('control'));
    await seedSalaryThresholdSetup();
    const january = await seedSalaryWorkedMonth('2026-01');
    const february = await seedSalaryWorkedMonth('2026-02');
    await walkCommissionStatement(db, { tenant: A, period: '2026-03', ids, to: 'REVIEWED' });

    const delivery = await deliverAt(
      CURRENT,
      salaryEvent({ effectiveFrom: '2026-01-15', amount: '550.000', employeeId }),
    );

    expect(delivery).toEqual({ delivered: true });
    const rows = await corrections();
    expect(rows).toHaveLength(2);
    expect(rows).toMatchObject([
      {
        employee_id: A.employee,
        source_period: '2026-01',
        target_period: '2026-04',
        source_ref: january.sourceRef,
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
        amount: '-5.000',
        previous_amount: '20.000',
        new_amount: '15.000',
        generation: 1,
      },
    ]);
    expect(await generations()).toEqual([
      { employee_id: A.employee, period: '2026-01', generation: 1 },
      { employee_id: A.employee, period: '2026-02', generation: 1 },
    ]);
  },
);

it.each(VARIANTS)(
  'real event path (contract canonicalizes tip ids first): a raised card tip event with a %s employee id posts one +3.000 correction in one generation',
  async (name, variant) => {
    const { sessionId, sourceRef } = await seedClosedTipMonth();
    expect(variant(A.employee) === A.employee).toBe(name.includes('control'));
    const event = tipEvent({
      sessionId,
      businessDate: '2026-10-15',
      revision: 2,
      tips: [{ employee_id: variant(A.employee), method: 'CARD', amount: '8.000' }],
    });

    expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });

    // عقد SessionTipsChanged بيوحّد هويات البقشيش قبل المعالج، فالحالة دي بتثبت النتيجة النهائية من البوابة الكاملة؛
    // طبقة الـ normalizer نفسها بتتثبّت في الاختبار اللي بعده بتجاوز العقد.
    const rows = await corrections();
    expect(rows).toHaveLength(1);
    expect(rows).toMatchObject([
      {
        employee_id: A.employee,
        source_period: '2026-10',
        target_period: '2026-11',
        source_ref: sourceRef,
        kind: 'TIP_CARD',
        amount: '3.000',
        previous_amount: '5.000',
        new_amount: '8.000',
        generation: 1,
        event_id: event.id,
      },
    ]);
    expect(await generations()).toEqual([
      { employee_id: A.employee, period: '2026-10', generation: 1 },
    ]);
  },
);

it.each(VARIANTS)(
  'defence layer behind the event contract (normalizer called directly, contract skipped): a tip entry with a %s employee id posts one +3.000 correction in one generation',
  async (name, variant) => {
    const { sessionId, sourceRef } = await seedClosedTipMonth();
    expect(variant(A.employee) === A.employee).toBe(name.includes('control'));
    const event = tipEvent({
      sessionId,
      businessDate: '2026-10-15',
      revision: 2,
      tips: [{ employee_id: variant(A.employee), method: 'CARD', amount: '8.000' }],
    });
    const clock = { now: () => new Date(CURRENT) };

    // الحمولة هنا خام (بلا مرور على عقد SessionTipsChanged)، فالـ normalizer هو الطبقة الوحيدة اللي بتوحّد الحالة.
    await db.withTenant(A.company, (tx) =>
      new ProjectSessionTips(
        createCommissionTipProjectionScope(tx, businessTimeZone, ids),
        clock,
        ids,
        createCommissionCorrectionScope(tx, ids, clock),
        noCommissionBlockNotices,
      ).execute(normalizeSessionTipsEvent(event, event.payload as SessionTipsChanged)),
    );

    const rows = await corrections();
    expect(rows).toHaveLength(1);
    expect(rows).toMatchObject([
      {
        employee_id: A.employee,
        source_period: '2026-10',
        target_period: '2026-11',
        source_ref: sourceRef,
        kind: 'TIP_CARD',
        amount: '3.000',
        previous_amount: '5.000',
        new_amount: '8.000',
        generation: 1,
        event_id: event.id,
      },
    ]);
    expect(await generations()).toEqual([
      { employee_id: A.employee, period: '2026-10', generation: 1 },
    ]);
  },
);
