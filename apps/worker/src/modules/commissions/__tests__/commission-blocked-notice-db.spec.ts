import { type ClaimedEvent, type Tx } from '@pospay/db';
import {
  commissionCorrectionBlockedNoticeGroupSize,
  commissionCorrectionBlockedNoticeRequested,
} from '@pospay/contracts';
import { createLogger } from '@pospay/observability';
import { expect, it } from 'vitest';

import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { COMMISSION_LINE_IDS } from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { SECOND_REVIEWER } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { employeeNameMatchKey } from '@pospay/domain';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';
import {
  onCommissionInputEvent,
  type CommissionInputUseCases,
} from '../events/handlers/on-commission-input-event.handler.ts';
import { createCommissionCorrectionScope } from '../persistence/commission-correction.scope.ts';
import { createCommissionBlockNotices } from '../persistence/commission-block-notice.outbox.ts';
import { createCommissionLineProjectionScope } from '../persistence/commission-line-projection.scope.ts';
import type { CommissionBlockNotices } from '../ports/commission-block-notice.port.ts';
import { ProjectServiceLines } from '../use-cases/project-service-lines/project-service-lines.ts';
import {
  A,
  approveClosed,
  blocks,
  CURRENT,
  db,
  deliver,
  ids,
  linesAdded,
  marks,
  owner,
  seedLineSession,
  seedPlan,
  seedSeptemberNoSalary,
  seedSeptemberPlanGap,
} from './commission-blocked-corrections-db.fixture.ts';
import { commissionSalaryEvent } from './commission-tip-salary-events.ts';
import type { OutboxConsumer } from '../../../outbox/consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';

const bellRows = () =>
  owner`SELECT seq, aggregate_id::text AS aggregate_id, payload FROM outbox
    WHERE company_id=${A.company} AND event_type='CommissionCorrectionBlockedNoticeRequested'
    ORDER BY seq`;

const businessTimeZone = fakeBusinessTimeZone(A.business);

const bellPayloads = async () =>
  (await bellRows()).map((row) => commissionCorrectionBlockedNoticeRequested.parse(row.payload));

it('N4 (CM-54) a failure at the third bell append rolls back the block and every group', async () => {
  const { lateEvent } = await seedSeptemberPlanGap();
  const marksBefore = await marks();
  const { delivery, writtenGroups } = await deliverFailingThirdAppend(lateEvent);
  expect(delivery).toMatchObject({ delivered: false });
  expect(writtenGroups).toEqual([0, 1]);
  expect(await blocks()).toEqual([]);
  expect(await bellRows()).toEqual([]);
  expect(await marks()).toEqual(marksBefore);
}, 60_000);

it('N5 (CM-54) a code change and a later event on an open block ring nothing new', async () => {
  const { lineEvent } = await seedSeptemberNoSalary('2026-09-15');

  expect(await deliver(CURRENT, lineEvent)).toEqual({ delivered: true });
  expect(await blocks()).toMatchObject([{ code: 'NO_SALARY', resolved_at: null }]);
  const payloads = await bellPayloads();
  expect(payloads).toHaveLength(1);
  expect(payloads[0]?.notification_recipients.map((recipient) => recipient.user_id)).toEqual(
    [SECOND_REVIEWER.user, USER].sort(),
  );

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
  expect(await bellPayloads()).toHaveLength(1);

  const keepEvent = linesAdded(
    [
      {
        lineId: ids.newId(),
        businessDate: '2026-09-05',
        occurredAt: '2026-09-05T09:00:00.000Z',
        net: '100.000',
        revision: 1,
        ruleSnapshot: { kind: 'FOLLOW_PLAN' },
      },
    ],
    COMMISSION_LINE_IDS.sessionA,
  );
  expect(await deliver(CURRENT, keepEvent)).toEqual({ delivered: true });
  expect(await blocks()).toMatchObject([{ code: 'NO_PLAN', resolved_at: null }]);
  expect(await bellPayloads()).toHaveLength(1);
});

it('N5b (CM-54) the resolution of the block rings nothing new', async () => {
  const { lineEvent } = await seedSeptemberNoSalary('2025-06-01');

  expect(await deliver(CURRENT, lineEvent)).toEqual({ delivered: true });
  expect(await bellPayloads()).toHaveLength(1);

  const salaryEvent = commissionSalaryEvent(A, ids, {
    effectiveFrom: '2026-09-01',
    amount: '500.000',
    revision: 1,
  });
  expect(await deliver(CURRENT, salaryEvent)).toEqual({ delivered: true });
  expect(await blocks()).toMatchObject([{ code: 'NO_SALARY', resolved_generation: 2 }]);
  expect(await bellPayloads()).toHaveLength(1);
});

it('N10 (plan-55-2 line 621) the bell rings once per block: one event blocking two employees rings two bells', async () => {
  const { lateEvent, secondEmployee } = await seedTwoEmployeePlanGap();

  expect(await deliver(CURRENT, lateEvent)).toEqual({ delivered: true });

  const blockedRows = await blocks();
  expect(blockedRows).toHaveLength(2);
  expect(blockedRows.map((row) => row.employee_id).sort()).toEqual(
    [A.employee, secondEmployee].sort(),
  );
  const payloads = await bellPayloads();
  expect(payloads).toHaveLength(2);
  for (const payload of payloads) {
    expect(payload.group_index).toBe(0);
    expect(payload.source_period).toBe('2026-09');
    expect(payload.notification_recipients.map((recipient) => recipient.user_id)).toEqual(
      [SECOND_REVIEWER.user, USER].sort(),
    );
  }
  expect(payloads.map((payload) => payload.block_id).sort()).toEqual(
    blockedRows.map((row) => row.id).sort(),
  );
}, 60_000);

/** يبني سيناريو بند متأخر واحد بمنفّذتين قبل خطة الأولى؛ يرجع الحدث وموظفة الثانية. */
async function seedTwoEmployeePlanGap() {
  const secondUser = ids.newId();
  const secondEmployee = ids.newId();
  await owner`INSERT INTO "user"(id, name, email)
    VALUES (${secondUser}, 'Commission employee 2', 'commission-employee-2@example.test')`;
  await owner`INSERT INTO employees(company_id, id, business_id, primary_branch_id, user_id,
      name_en, name_en_key, role_code, hire_date, employee_number)
    VALUES (${A.company}, ${secondEmployee}, ${A.business}, ${A.branch}, ${secondUser},
      'Commission employee 2', ${employeeNameMatchKey('Commission employee 2')}, 'staff',
      '2026-01-01', 3)`;
  await seedLineSession('2026-09', 15, '200.000');
  await seedPlan('2026-09-15', {
    base: { enabled: true, calc: { kind: 'PCT', bps: 500 } },
    tiers: { enabled: false },
    package_sale: { enabled: false },
  });
  await approveClosed('2026-09', [
    {
      kind: 'COMMISSION',
      lineId: COMMISSION_LINE_IDS.lineA,
      sourceRef: `line:${COMMISSION_LINE_IDS.lineA}`,
      amount: '10.000',
      sourceBusinessDate: '2026-09-15',
    },
  ]);
  const lateEvent = linesAdded(
    [
      {
        lineId: COMMISSION_LINE_IDS.lineB,
        businessDate: '2026-09-10',
        occurredAt: '2026-09-10T09:00:00.000Z',
        net: '200.000',
        previousNet: '200.000',
        revision: 1,
        ruleSnapshot: { kind: 'FOLLOW_PLAN' },
        performers: [
          { employee_id: A.employee, share_bps: 5000 },
          { employee_id: secondEmployee, share_bps: 5000 },
        ],
      },
    ],
    COMMISSION_LINE_IDS.sessionA,
  );
  return { lateEvent, secondEmployee };
}

/** مستهلك يفشل إلحاق مجموعة الجرس الثالثة بعد تسجيل التوقف؛ إخفاق المجموعة بيلغي التوقف ومجموعاتها (CM-54). */
async function deliverFailingThirdAppend(event: ClaimedEvent) {
  const clock = { now: () => new Date(CURRENT) };
  const standard = createTestCommissionInputsConsumer({ ids, clock, businessTimeZone });
  const writtenGroups: number[] = [];
  const consumer: OutboxConsumer = {
    id: standard.id,
    eventTypes: standard.eventTypes,
    handle: async (tx, claimed) => {
      const corrections = createCommissionCorrectionScope(tx, ids, clock);
      const unused = {
        execute: async () => {
          throw new Error('unused line-only use case');
        },
      } as unknown as CommissionInputUseCases['tips'] & CommissionInputUseCases['salary'] &
        CommissionInputUseCases['sales'];
      await onCommissionInputEvent(
        {
          lines: new ProjectServiceLines(
            createCommissionLineProjectionScope(tx, businessTimeZone),
            clock,
            ids,
            corrections,
            bindFailingNotices(tx, clock, (index) => writtenGroups.push(index)),
          ),
          tips: unused,
          salary: unused,
          sales: unused,
        },
        claimed,
      );
    },
  };
  const delivery = await createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  })(event);
  return { delivery, writtenGroups };
}

function bindFailingNotices(
  tx: Tx,
  clock: { now(): Date },
  onWritten: (groupIndex: number) => void,
): CommissionBlockNotices {
  const notices = createCommissionBlockNotices(tx, ids, clock, {
    permissionHolders: async () => Array.from({ length: 250 }, () => ids.newId()),
    groupSize: commissionCorrectionBlockedNoticeGroupSize,
    parsePayload: (payload) => commissionCorrectionBlockedNoticeRequested.parse(payload),
  });
  return {
    ...notices,
    append: async (input) => {
      if (input.groupIndex === 2) throw new Error('injected third append failure');
      await notices.append(input);
      onWritten(input.groupIndex);
    },
  };
}
