import { describe, expect, it, vi } from 'vitest';
import type { ClaimedEvent, Tx } from '@pospay/db';
import { onServiceSessionEvent } from '../handlers/on-service-session-event.handler.ts';
import type { ScheduleRatingRequest } from '../../use-cases/schedule-rating-request/schedule-rating-request.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const SESSION = '01920000-0000-7000-8000-000000004005';

const IDENTITY = {
  session_id: SESSION,
  business_id: '01920000-0000-7000-8000-0000000000a1',
  branch_id: '01920000-0000-7000-8000-0000000000a2',
  customer_id: '01920000-0000-7000-8000-000000004002',
  occurred_at: '2026-10-05T12:10:00.000Z',
  recorded_at: '2026-10-05T12:10:00.000Z',
  business_date: '2026-10-05',
  late: false,
  recorded_by: '01920000-0000-7000-8000-0000000000f1',
  recorded_by_membership_id: '01920000-0000-7000-8000-000000004001',
};

const LINE = {
  ...IDENTITY,
  line_id: '01920000-0000-7000-8000-000000004006',
  service_id: '01920000-0000-7000-8000-000000004003',
  status: 'ACTIVE',
  list_price: '1.000',
  price: '1.000',
  discount: '0.000',
  net: '1.000',
  performers: [{ employee_id: '01920000-0000-7000-8000-000000004004', share_bps: 10000 }],
  rule_snapshot: { kind: 'ZERO' },
  counts_snapshot: true,
  package: null,
  revision: 1,
};

const ENVELOPE = {
  ...IDENTITY,
  schema_version: 1,
  business_timezone: 'Asia/Kuwait',
  lines: [LINE],
};

const tx = {} as Tx;

function stubUseCase() {
  const execute = vi.fn();
  return { execute, useCase: { execute } as unknown as ScheduleRatingRequest };
}

function eventOf(
  eventType: string,
  payload: unknown,
  overrides: Partial<ClaimedEvent> = {},
): ClaimedEvent {
  return {
    companyId: COMPANY,
    id: '01920000-0000-7000-8000-0000000000b0',
    aggregateType: 'service_session',
    aggregateId: SESSION,
    eventType,
    payload,
    attempt: 1,
    ...overrides,
  };
}

async function expectScheduledOnce(
  execute: ReturnType<typeof stubUseCase>['execute'],
  useCase: ScheduleRatingRequest,
  event: ClaimedEvent,
): Promise<void> {
  await onServiceSessionEvent(useCase, tx, event);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledWith(tx, {
    companyId: COMPANY,
    businessId: IDENTITY.business_id,
    customerId: IDENTITY.customer_id,
    branchId: IDENTITY.branch_id,
    occurredAt: new Date(IDENTITY.occurred_at),
  });
}

describe('onServiceSessionEvent', () => {
  it('schedules a recorded session from the parsed identity', async () => {
    const { execute, useCase } = stubUseCase();
    await expectScheduledOnce(execute, useCase, eventOf('ServiceSessionRecorded', ENVELOPE));
  });

  it('schedules appended lines from the parsed identity', async () => {
    const { execute, useCase } = stubUseCase();
    await expectScheduledOnce(execute, useCase, eventOf('ServiceSessionLinesAdded', ENVELOPE));
  });

  it('schedules a changed line from the parsed identity', async () => {
    const { execute, useCase } = stubUseCase();
    await expectScheduledOnce(execute, useCase, eventOf('ServiceLineChanged', LINE));
  });
});

describe('onServiceSessionEvent refusals', () => {
  it.each([
    ['ServiceSessionRecorded', ENVELOPE],
    ['ServiceSessionLinesAdded', ENVELOPE],
    ['ServiceLineChanged', LINE],
  ])('refuses line aggregate identity for %s', async (eventType, payload) => {
    const { execute, useCase } = stubUseCase();
    // line-write-transactions.ts يكتب service_session/sessionId حتى عند تغيير بند واحد.
    for (const overrides of [{ aggregateType: 'service_line' }, { aggregateId: LINE.line_id }]) {
      await expect(
        onServiceSessionEvent(useCase, tx, eventOf(eventType as string, payload, overrides)),
      ).rejects.toThrow('RATING_SCHEDULE_EVENT_INVALID');
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses an aggregate type that is not the session one', async () => {
    const { execute, useCase } = stubUseCase();
    const event = eventOf('ServiceSessionRecorded', ENVELOPE, { aggregateType: 'service_line' });
    await expect(onServiceSessionEvent(useCase, tx, event)).rejects.toThrow(
      'RATING_SCHEDULE_EVENT_INVALID',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses an aggregate id that is not the session id', async () => {
    const { execute, useCase } = stubUseCase();
    const event = eventOf('ServiceSessionRecorded', ENVELOPE, {
      aggregateId: '01920000-0000-7000-8000-00000000ffff',
    });
    await expect(onServiceSessionEvent(useCase, tx, event)).rejects.toThrow(
      'RATING_SCHEDULE_EVENT_INVALID',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses an invalid payload', async () => {
    const { execute, useCase } = stubUseCase();
    const event = eventOf('ServiceSessionRecorded', { ...ENVELOPE, lines: [] });
    await expect(onServiceSessionEvent(useCase, tx, event)).rejects.toThrow(
      'RATING_SCHEDULE_EVENT_INVALID',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses an unknown event type', async () => {
    const { execute, useCase } = stubUseCase();
    const event = eventOf('ServiceSessionDeleted', ENVELOPE);
    await expect(onServiceSessionEvent(useCase, tx, event)).rejects.toThrow(
      'RATING_SCHEDULE_EVENT_INVALID',
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
