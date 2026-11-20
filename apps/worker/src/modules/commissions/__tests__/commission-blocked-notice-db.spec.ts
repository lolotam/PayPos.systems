import { SYSTEM_ROLES, type ClaimedEvent } from '@pospay/db';
import { commissionCorrectionBlockedNoticeRequested } from '@pospay/contracts';
import { createLogger } from '@pospay/observability';
import { expect, it } from 'vitest';

import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { COMMISSION_LINE_IDS } from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { SECOND_REVIEWER } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';
import {
  onCommissionInputEvent,
  type CommissionInputUseCases,
} from '../events/handlers/on-commission-input-event.handler.ts';
import { createCommissionCorrectionScope } from '../persistence/commission-correction.scope.ts';
import { createCommissionLineProjectionScope } from '../persistence/commission-line-projection.scope.ts';
import type { CommissionBlockNotices } from '../ports/commission-block-notice.port.ts';
import { ProjectServiceLines } from '../use-cases/project-service-lines/project-service-lines.ts';
import {
  A,
  blocks,
  CURRENT,
  db,
  deliver,
  ids,
  linesAdded,
  marks,
  owner,
  seedSeptemberNoSalary,
  seedSeptemberPlanGap,
} from './commission-blocked-corrections-db.fixture.ts';
import { commissionSalaryEvent } from './commission-tip-salary-events.ts';
import type { OutboxConsumer } from '../../../outbox/consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';

const accountantRole = SYSTEM_ROLES.find((role) => role.code === 'accountant');
if (accountantRole === undefined) throw new Error('the accountant role is missing');

const businessTimeZone = fakeBusinessTimeZone(A.business);

const bellRows = () =>
  owner`SELECT seq, aggregate_id::text AS aggregate_id, payload FROM outbox
    WHERE company_id=${A.company} AND event_type='CommissionCorrectionBlockedNoticeRequested'
    ORDER BY seq`;

const bellPayloads = async () =>
  (await bellRows()).map((row) => commissionCorrectionBlockedNoticeRequested.parse(row.payload));

it('N4 (CM-54) a failure at the third bell append rolls back the block and every group', async () => {
  const { lateEvent } = await seedSeptemberPlanGap();
  const marksBefore = await marks();

  expect(await deliverFailingThirdAppend(lateEvent)).toMatchObject({ delivered: false });

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

it('N3 (CM-54) 250 holders ring three grouped bells of 100, 100 and 50 with the block', async () => {
  // الاختبار ده بيضيف أعضاء كثر، فبيتشغّل الأخير عشان مايلوّثش قراءة حاملي الصلاحية في اللي قبله.
  const holders = Array.from({ length: 248 }, () => ids.newId());
  await owner.begin(async (tx) => {
    for (const [index, holder] of holders.entries()) {
      await tx`INSERT INTO "user"(id, name, email)
        VALUES (${holder}, ${'Commission holder ' + index}, ${'commission-holder-' + index + '@example.test'})`;
      await tx`INSERT INTO memberships(company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at)
        VALUES (${A.company}, ${ids.newId()}, ${holder}, ${accountantRole.id}, 'global', 'BUSINESS', ${A.business}, '2026-01-01')`;
    }
  });
  const everyone = [...holders, SECOND_REVIEWER.user, USER].sort();
  const { lateEvent } = await seedSeptemberPlanGap();

  expect(await deliver(CURRENT, lateEvent)).toEqual({ delivered: true });

  expect(await blocks()).toHaveLength(1);
  const payloads = await bellPayloads();
  expect(payloads.map((payload) => payload.group_index)).toEqual([0, 1, 2]);
  expect(payloads.map((payload) => payload.notification_recipients.length)).toEqual([100, 100, 50]);
  const recipients = payloads.flatMap((payload) =>
    payload.notification_recipients.map((recipient) => recipient.user_id),
  );
  expect(recipients).toEqual(everyone);
  for (const payload of payloads) {
    expect(payload.business_id).toBe(A.business);
    expect(payload.source_period).toBe('2026-09');
    expect(payload.notification_recipients.map((recipient) => recipient.user_id)).toEqual(
      [...payload.notification_recipients.map((recipient) => recipient.user_id)].sort(),
    );
  }
  expect(payloads.every((payload) => payload.block_id === payloads[0]?.block_id)).toBe(true);
  const block = (await blocks())[0];
  expect((await bellRows())[0]?.aggregate_id).toBe(block?.id);
}, 120_000);

/** مستهلك يفشل إلحاق مجموعة الجرس الثالثة بعد تسجيل التوقف؛ إخفاق المجموعة بيلغي التوقف ومجموعاتها (CM-54). */
function deliverFailingThirdAppend(event: ClaimedEvent) {
  const clock = { now: () => new Date(CURRENT) };
  const standard = createTestCommissionInputsConsumer({ ids, clock, businessTimeZone });
  const notices: CommissionBlockNotices = {
    now: () => clock.now(),
    recipients: async () => Array.from({ length: 250 }, () => ids.newId()),
    append: async (input) => {
      if (input.groupIndex === 2) throw new Error('injected third append failure');
    },
  };
  const consumer: OutboxConsumer = {
    id: standard.id,
    eventTypes: standard.eventTypes,
    handle: async (tx, claimed) => {
      const corrections = createCommissionCorrectionScope(tx, ids, clock);
      const unused = {
        execute: async () => {
          throw new Error('unused line-only use case');
        },
      } as unknown as CommissionInputUseCases['tips'] & CommissionInputUseCases['salary'];
      await onCommissionInputEvent(
        {
          lines: new ProjectServiceLines(
            createCommissionLineProjectionScope(tx, businessTimeZone),
            clock,
            ids,
            corrections,
            notices,
          ),
          tips: unused,
          salary: unused,
        },
        claimed,
      );
    },
  };
  return createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  })(event);
}
