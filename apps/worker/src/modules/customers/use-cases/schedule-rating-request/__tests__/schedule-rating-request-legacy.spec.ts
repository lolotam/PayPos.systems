import type { Tx } from '@pospay/db';
import { expect, it } from 'vitest';
import type { RatingRequestRow } from '../../../ports/rating-request.repository.ts';
import {
  ScheduleRatingRequest,
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
  dueAt: new Date('2026-10-05T22:30:00Z'),
  sendDeadline: new Date('2026-10-05T23:30:00Z'),
};

function makeUseCase(overrides: Partial<ScheduleRatingRequestPorts>): ScheduleRatingRequest {
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
    { now: () => new Date('2026-10-05T21:25:00Z') },
  );
}

it('PP-286 T-3: uses daySessions.readRecordedAt and revalidates claimedAt under the request lock', async () => {
  const assigned: string[] = [];
  let lockedRow: RatingRequestRow = { ...scheduledRow, claimedAt: null };
  const baseLine = {
    lineId: 'line-rec',
    sessionId,
    branchId,
    occurredAt: new Date('2026-10-05T21:15:00Z'),
    recordedAt: new Date('2026-10-05T21:20:00Z'),
    businessTimezone: 'Asia/Kuwait',
    requestDay: null,
    performers: [{ employeeId, shareBps: 10_000 }],
  };
  const useCase = makeUseCase({
    daySessions: {
      activeLines: async () => [baseLine],
      readRequestDay: async () => null,
      readRecordedAt: async () => new Date('2026-10-05T21:20:00Z'),
      assignRequestDay: async (_tx, _c, _b, _id, d) => (assigned.push(d), d),
      sessionsSince: async () => [],
      countSince: async () => 0,
      watermark: async () => null,
    },
    requests: {
      lock: async () => lockedRow,
      insertIfAbsent: async () => undefined,
      schedule: async () => undefined,
      cancel: async () => undefined,
      findPreviousDayRequest: async () => ({
        businessDate: '2026-10-05',
        branchId,
        dueAt: scheduledRow.dueAt,
        sendDeadline: scheduledRow.sendDeadline,
        claimedAt: null,
      }),
    },
  });
  lockedRow = { ...lockedRow, status: 'SENDING', claimedAt: new Date('2026-10-05T21:10:00Z') };
  await expect(
    useCase.execute(tx, {
      companyId,
      businessId,
      customerId,
      branchId,
      sessionId,
      occurredAt: new Date('2026-10-05T21:15:00Z'),
    }),
  ).rejects.toMatchObject({ expectedDay: '2026-10-05', persistedDay: '2026-10-06' });
  expect(assigned).toEqual([]);
});

it('PP-286 T-3: reads original recordedAt via port even when event payload has append time', async () => {
  const assigned: { id: string; day: string }[] = [];
  const baseLine = {
    lineId: 'line-append',
    sessionId,
    branchId,
    occurredAt: new Date('2026-10-05T21:15:00Z'),
    recordedAt: new Date('2026-10-05T21:20:00Z'),
    businessTimezone: 'Asia/Kuwait',
    requestDay: null,
    performers: [{ employeeId, shareBps: 10_000 }],
  };
  const useCase = makeUseCase({
    daySessions: {
      activeLines: async () => [baseLine],
      readRequestDay: async () => null,
      readRecordedAt: async () => new Date('2026-10-05T21:20:00Z'),
      assignRequestDay: async (_tx, _c, _b, id, day) => (assigned.push({ id, day }), day),
      sessionsSince: async () => [],
      countSince: async () => 0,
      watermark: async () => null,
    },
    requests: {
      lock: async () => ({
        ...scheduledRow,
        status: 'SENT',
        claimedAt: new Date('2026-10-05T21:30:00Z'),
      }),
      insertIfAbsent: async () => undefined,
      schedule: async () => undefined,
      cancel: async () => undefined,
      findPreviousDayRequest: async () => ({
        businessDate: '2026-10-05',
        branchId,
        dueAt: scheduledRow.dueAt,
        sendDeadline: scheduledRow.sendDeadline,
        claimedAt: new Date('2026-10-05T21:30:00Z'),
      }),
    },
  });
  const outcome = await useCase.execute(tx, {
    companyId,
    businessId,
    customerId,
    branchId,
    sessionId,
    occurredAt: new Date('2026-10-05T21:15:00Z'),
  });
  expect(outcome).toBe('LEFT_AS_IS');
  expect(assigned).toEqual([{ id: sessionId, day: '2026-10-05' }]);
});

it('PP-286 T-3: keeps an anchored 00:45 overnight visit recorded at 01:50 SCHEDULED after hours-clear reschedule', async () => {
  const afterClearUseCase = makeUseCase({
    hours: { hours: async () => ({ openingHours: null, timeZone: 'Asia/Kuwait' }) },
    daySessions: {
      activeLines: async () => [
        {
          lineId: 'line-0045',
          sessionId,
          branchId,
          occurredAt: new Date('2026-10-05T21:45:00Z'),
          recordedAt: new Date('2026-10-05T22:50:00Z'),
          businessTimezone: 'Asia/Kuwait',
          requestDay: '2026-10-05',
          performers: [{ employeeId, shareBps: 10_000 }],
        },
      ],
      readRequestDay: async () => '2026-10-05',
      assignRequestDay: async (_tx, _c, _b, _id, d) => d,
      sessionsSince: async () => [],
      countSince: async () => 0,
      watermark: async () => null,
    },
    requests: {
      lock: async () => ({
        ...scheduledRow,
        dueAt: new Date('2026-10-05T22:45:00Z'),
        sendDeadline: null,
      }),
      insertIfAbsent: async () => undefined,
      schedule: async () => undefined,
      cancel: async () => undefined,
    },
  });
  expect(
    await afterClearUseCase.execute(tx, {
      companyId,
      businessId,
      customerId,
      branchId,
      sessionId,
      occurredAt: new Date('2026-10-05T21:45:00Z'),
    }),
  ).toBe('SCHEDULED');
});
