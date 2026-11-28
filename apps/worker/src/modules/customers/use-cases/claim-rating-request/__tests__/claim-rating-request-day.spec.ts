import { expect, it } from 'vitest';
import type { Tx } from '@pospay/db';
import { ratingBusinessName } from '@pospay/i18n';

import type { DueRatingRequest, RatingCustomer } from '../../../ports/rating-claim.repository.ts';
import { ClaimRatingRequest, type ClaimRatingRequestPorts } from '../claim-rating-request.ts';

const tx = {} as Tx;
const companyId = '01920000-0000-7000-8000-0000000000b2';
const businessId = '01920000-0000-7000-8000-0000000000c3';
const branchId = '01920000-0000-7000-8000-0000000000d4';
const customerId = '01920000-0000-7000-8000-0000000000e5';
const requestId = '01920000-0000-7000-8000-0000000000f6';
const employeeId = '01920000-0000-7000-8000-000000000a17';

const stored: DueRatingRequest = {
  id: requestId,
  businessId,
  customerId,
  businessDate: '2026-10-05',
  branchId,
  dueAt: new Date('2026-10-05T13:10:00Z'),
  sendDeadline: new Date('2026-10-05T23:30:00Z'),
  status: 'SCHEDULED',
};

const customer: RatingCustomer = {
  id: customerId,
  name: 'فاطمة علي',
  phone: '+96550000000',
  locale: 'ar',
  optedOutAt: null,
};

function basePorts(overrides: Partial<ClaimRatingRequestPorts> = {}): ClaimRatingRequestPorts {
  return {
    switch: { enabled: async () => true },
    hours: {
      hours: async () => ({
        openingHours: [{ weekday: 1, intervals: [{ opens: '09:00', closes: '23:59' }] }],
        timeZone: 'Asia/Kuwait',
      }),
    },
    names: { names: async () => ({ name_ar: 'مطعم البحر', name_en: 'Sea Restaurant' }) },
    daySessions: {
      activeLines: async () => [],
      sessionsSince: async () => [],
      countSince: async () => 0,
      watermark: async () => null,
    },
    performers: { firstNames: async () => [{ employeeId, nameAr: 'أحمد', nameEn: 'Ahmed' }] },
    label: {
      format: (choice) => (choice.kind === 'TEAM' ? 'TEAM' : choice.names.join('|')),
      businessName: ratingBusinessName,
    },
    claims: {
      upperId: async () => null,
      pageIds: async () => [],
      findRequest: async () => null,
      lockCustomer: async () => customer,
      lockRequest: async () => stored,
      reschedule: async () => undefined,
      cancel: async () => undefined,
      claim: async () => undefined,
      snapshotPerformers: async () => undefined,
    },
    token: { claim: () => ({ tokenHash: new Uint8Array(32), keyVersion: 1 }) },
    outbox: { append: async () => undefined },
    ...overrides,
  };
}

function useCase(overrides: Partial<ClaimRatingRequestPorts>): ClaimRatingRequest {
  let seq = 0;
  return new ClaimRatingRequest(
    basePorts(overrides),
    { newId: () => `01920000-0000-7000-8000-${String(seq++).padStart(12, '0')}` },
    { now: () => new Date('2026-10-05T21:20:00Z') },
  );
}

it('persists a missing session requestDay when claiming a scheduled request', async () => {
  const assigned: {
    companyId: string;
    businessId: string;
    sessionId: string;
    requestDay: string;
  }[] = [];
  const base = basePorts();
  const claim = useCase({
    daySessions: {
      ...base.daySessions,
      activeLines: async () => [
        {
          lineId: 'line-missing-day',
          sessionId: 'session-missing-day',
          branchId,
          occurredAt: new Date('2026-10-05T11:00:00Z'),
          recordedAt: new Date('2026-10-05T11:00:00Z'),
          businessTimezone: 'Asia/Kuwait',
          requestDay: null,
          performers: [{ employeeId, shareBps: 10_000 }],
        },
      ],
      assignRequestDay: async (_tx, cId, bId, sessionId, requestDay) => {
        assigned.push({ companyId: cId, businessId: bId, sessionId, requestDay });
        return requestDay;
      },
    },
  });

  expect(await claim.execute(tx, { companyId, request: stored })).toBe('CLAIMED');
  expect(assigned).toEqual([
    { companyId, businessId, sessionId: 'session-missing-day', requestDay: '2026-10-05' },
  ]);
});

it('reuses a stored requestDay without reassigning even when overnight hours are removed', async () => {
  const claims: { branchId: string; dueAt: Date; sendDeadline: Date | null }[] = [];
  let assignCalls = 0;
  const base = basePorts();
  const claim = useCase({
    daySessions: {
      ...base.daySessions,
      activeLines: async () => [
        {
          lineId: 'line-overnight',
          sessionId: 'session-overnight',
          branchId,
          occurredAt: new Date('2026-10-05T21:15:00Z'),
          recordedAt: new Date('2026-10-05T21:15:00Z'),
          businessTimezone: 'Asia/Kuwait',
          requestDay: '2026-10-05',
          performers: [{ employeeId, shareBps: 10_000 }],
        },
      ],
      assignRequestDay: async () => {
        assignCalls += 1;
        return '2026-10-05';
      },
    },
    claims: {
      ...base.claims,
      claim: async (_tx, _companyId, _requestId, value) => {
        claims.push(value);
      },
    },
  });

  expect(await claim.execute(tx, { companyId, request: stored })).toBe('CLAIMED');
  expect(assignCalls).toBe(0);
  expect(claims[0]).toMatchObject({
    branchId,
    dueAt: new Date('2026-10-05T20:59:00Z'),
    sendDeadline: new Date('2026-10-05T21:29:00Z'),
  });
});

it('assigns missing same-day sessions in ascending sessionId order without touching adjacent days', async () => {
  const assignedIds: string[] = [];
  const base = basePorts();
  const claim = useCase({
    daySessions: {
      ...base.daySessions,
      activeLines: async () => [
        {
          lineId: 'line-prev-day',
          sessionId: 'session-0-prev',
          branchId,
          occurredAt: new Date('2026-10-04T11:00:00Z'),
          recordedAt: new Date('2026-10-04T11:00:00Z'),
          businessTimezone: 'Asia/Kuwait',
          requestDay: null,
          performers: [{ employeeId, shareBps: 10_000 }],
        },
        {
          lineId: 'line-b',
          sessionId: 'session-b',
          branchId,
          occurredAt: new Date('2026-10-05T11:00:00Z'),
          recordedAt: new Date('2026-10-05T11:00:00Z'),
          businessTimezone: 'Asia/Kuwait',
          requestDay: null,
          performers: [{ employeeId, shareBps: 10_000 }],
        },
        {
          lineId: 'line-a',
          sessionId: 'session-a',
          branchId,
          occurredAt: new Date('2026-10-05T11:00:00Z'),
          recordedAt: new Date('2026-10-05T11:00:00Z'),
          businessTimezone: 'Asia/Kuwait',
          requestDay: null,
          performers: [{ employeeId, shareBps: 10_000 }],
        },
      ],
      assignRequestDay: async (_tx, _cId, _bId, sessionId, requestDay) => {
        assignedIds.push(sessionId);
        return requestDay;
      },
    },
  });

  expect(await claim.execute(tx, { companyId, request: stored })).toBe('CLAIMED');
  expect(assignedIds).toEqual(['session-a', 'session-b']);
});
