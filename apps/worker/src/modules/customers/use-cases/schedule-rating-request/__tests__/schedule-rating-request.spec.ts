import type { Tx } from '@pospay/db';
import { expect, it } from 'vitest';
import type { RatingRequestRow } from '../../../ports/rating-request.repository.ts';
import {
  ScheduleRatingRequest,
  SessionRequestDayMismatchError,
  type ScheduleRatingRequestPorts,
} from '../schedule-rating-request.ts';

const tx = {} as Tx;
const companyId = '01920000-0000-7000-8000-0000000000b2';
const businessId = '01920000-0000-7000-8000-0000000000c3';
const branchId = '01920000-0000-7000-8000-0000000000d4';
const customerId = '01920000-0000-7000-8000-0000000000e5';
const sessionId = '01920000-0000-7000-8000-0000000000f6';
const employeeId = '01920000-0000-7000-8000-000000000a17';

const scheduledRow: RatingRequestRow = {
  id: '01920000-0000-7000-8000-000000000101',
  status: 'SCHEDULED',
  cancelReason: null,
  branchId,
  dueAt: new Date('2026-10-05T13:00:00Z'),
  sendDeadline: new Date('2026-10-05T20:59:00Z'),
};

function createUseCase(overrides: Partial<ScheduleRatingRequestPorts>): ScheduleRatingRequest {
  let seq = 0;
  return new ScheduleRatingRequest(
    {
      switch: { enabled: async () => true },
      hours: {
        hours: async () => ({
          openingHours: [{ weekday: 1, intervals: [{ opens: '09:00', closes: '23:59' }] }],
          timeZone: 'Asia/Kuwait',
        }),
      },
      daySessions: {
        activeLines: async () => [],
        readRequestDay: async () => null,
        assignRequestDay: async (_tx, _c, _b, _s, requestDay) => requestDay,
        sessionsSince: async () => [],
        countSince: async () => 0,
        watermark: async () => null,
      },
      requests: {
        lock: async () => scheduledRow,
        insertIfAbsent: async () => undefined,
        schedule: async () => undefined,
        cancel: async () => undefined,
      },
      ...overrides,
    },
    { newId: () => `01920000-0000-7000-8000-${String(seq++).padStart(12, '0')}` },
    { now: () => new Date('2026-10-05T10:00:00Z') },
  );
}

function spyPorts(initialRow: RatingRequestRow | null) {
  const order: string[] = [];
  const assigned: string[] = [];
  let row = initialRow;
  let storedDay: string | null = null;
  const activeLine = {
    lineId: 'line-1',
    sessionId,
    branchId,
    occurredAt: new Date('2026-10-05T10:00:00Z'),
    recordedAt: new Date('2026-10-05T10:00:00Z'),
    businessTimezone: 'Asia/Kuwait',
    requestDay: null as string | null,
    performers: [{ employeeId, shareBps: 10_000 }],
  };
  const ports: Partial<ScheduleRatingRequestPorts> = {
    daySessions: {
      activeLines: async () => (
        order.push('activeLines'),
        [{ ...activeLine, requestDay: storedDay }]
      ),
      readRequestDay: async () => (order.push('readRequestDay'), storedDay),
      assignRequestDay: async (_tx, _c, _b, id, requestDay) => {
        order.push(`assignRequestDay:${id}`);
        assigned.push(id);
        storedDay = requestDay;
        return requestDay;
      },
      sessionsSince: async () => [],
      countSince: async () => 0,
      watermark: async () => null,
    },
    requests: {
      lock: async () => (order.push('requests.lock'), row),
      insertIfAbsent: async () => {
        order.push('requests.insertIfAbsent');
        row = scheduledRow;
      },
      schedule: async () => (order.push('requests.schedule'), undefined),
      cancel: async () => undefined,
    },
  };
  return { order, assigned, useCase: createUseCase(ports) };
}

it('reads stored day before lock and writes service_sessions only after locking rating_requests', async () => {
  const { order, useCase } = spyPorts(null);
  const outcome = await useCase.execute(tx, {
    companyId,
    businessId,
    customerId,
    branchId,
    sessionId,
    occurredAt: new Date('2026-10-05T10:00:00Z'),
  });
  expect(outcome).toBe('SCHEDULED');
  expect(order).toEqual([
    'readRequestDay',
    'requests.lock',
    'activeLines',
    'requests.insertIfAbsent',
    'requests.lock',
    'activeLines',
    `assignRequestDay:${sessionId}`,
    'requests.schedule',
  ]);
});

it('persists session rating_request_day after lock when request is LEFT_AS_IS', async () => {
  const { assigned, useCase } = spyPorts({ ...scheduledRow, status: 'SENT' });
  const outcome = await useCase.execute(tx, {
    companyId,
    businessId,
    customerId,
    branchId,
    sessionId,
    occurredAt: new Date('2026-10-05T10:00:00Z'),
  });
  expect(outcome).toBe('LEFT_AS_IS');
  expect(assigned).toEqual([sessionId]);
});

it('persists session rating_request_day when no active lines exist to schedule', async () => {
  const empty = spyPorts(null);
  const useCase = createUseCase({
    daySessions: {
      activeLines: async () => [],
      readRequestDay: async () => null,
      assignRequestDay: async (_tx, _c, _b, id, requestDay) => {
        empty.assigned.push(id);
        return requestDay;
      },
      sessionsSince: async () => [],
      countSince: async () => 0,
      watermark: async () => null,
    },
    requests: {
      lock: async () => null,
      insertIfAbsent: async () => undefined,
      schedule: async () => undefined,
      cancel: async () => undefined,
    },
  });
  const outcome = await useCase.execute(tx, {
    companyId,
    businessId,
    customerId,
    branchId,
    sessionId,
    occurredAt: new Date('2026-10-05T10:00:00Z'),
  });
  expect(outcome).toBe('NOTHING_TO_SCHEDULE');
  expect(empty.assigned).toEqual([sessionId]);
});

it('assigns triggering session and unassigned same-day sessions in ascending sessionId order', async () => {
  const earlierId = '01920000-0000-7000-8000-000000000001';
  const laterId = '01920000-0000-7000-8000-0000000000ff';
  const assigned: string[] = [];
  const lineOf = (id: string) => ({
    lineId: `line-${id}`,
    sessionId: id,
    branchId,
    occurredAt: new Date('2026-10-05T10:00:00Z'),
    recordedAt: new Date('2026-10-05T10:00:00Z'),
    businessTimezone: 'Asia/Kuwait',
    requestDay: null,
    performers: [{ employeeId, shareBps: 10_000 }],
  });
  const useCase = createUseCase({
    daySessions: {
      activeLines: async () => [lineOf(laterId), lineOf(sessionId), lineOf(earlierId)],
      readRequestDay: async () => null,
      assignRequestDay: async (_tx, _c, _b, id, requestDay) => {
        assigned.push(id);
        return requestDay;
      },
      sessionsSince: async () => [],
      countSince: async () => 0,
      watermark: async () => null,
    },
  });
  const outcome = await useCase.execute(tx, {
    companyId,
    businessId,
    customerId,
    branchId,
    sessionId,
    occurredAt: new Date('2026-10-05T10:00:00Z'),
  });
  expect(outcome).toBe('SCHEDULED');
  expect(assigned).toEqual([earlierId, sessionId, laterId]);
});

it('throws SessionRequestDayMismatchError when assignRequestDay returns a different persisted day', async () => {
  const useCase = createUseCase({
    daySessions: {
      activeLines: async () => [
        {
          lineId: 'line-1',
          sessionId,
          branchId,
          occurredAt: new Date('2026-10-05T10:00:00Z'),
          recordedAt: new Date('2026-10-05T10:00:00Z'),
          businessTimezone: 'Asia/Kuwait',
          requestDay: null,
          performers: [{ employeeId, shareBps: 10_000 }],
        },
      ],
      readRequestDay: async () => null,
      assignRequestDay: async () => '2026-10-04',
      sessionsSince: async () => [],
      countSince: async () => 0,
      watermark: async () => null,
    },
  });
  const execution = useCase.execute(tx, {
    companyId,
    businessId,
    customerId,
    branchId,
    sessionId,
    occurredAt: new Date('2026-10-05T10:00:00Z'),
  });
  await expect(execution).rejects.toBeInstanceOf(SessionRequestDayMismatchError);
  await expect(execution).rejects.toMatchObject<Partial<SessionRequestDayMismatchError>>({
    name: 'SessionRequestDayMismatchError',
    sessionId,
    expectedDay: '2026-10-05',
    persistedDay: '2026-10-04',
  });
});
