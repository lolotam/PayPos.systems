import { describe, expect, it } from 'vitest';
import type { Tx } from '@pospay/db';
import { ratingBusinessName } from '@pospay/i18n';
import type { RatingRequestReady } from '@pospay/contracts';

import type { ActiveLine } from '../../../domain/sessions-of-day.ts';
import type { BranchScheduleHoursPort } from '../../../ports/branch-schedule-hours.port.ts';
import type { BusinessNamesPort } from '../../../ports/business-names.port.ts';
import type { Clock, IdGenerator } from '../../../ports/clock.port.ts';
import type { DaySessionsPort } from '../../../ports/day-sessions.port.ts';
import type { PerformerNamePort } from '../../../ports/performer-name.port.ts';
import type { PerformerLabelPort } from '../../../ports/performer-label.port.ts';
import type {
  DueRatingRequest,
  RatingClaimRepository,
  RatingCustomer,
} from '../../../ports/rating-claim.repository.ts';
import type { RatingOutboxPort } from '../../../ports/rating-outbox.port.ts';
import type { RatingTokenPort } from '../../../ports/rating-token.port.ts';
import type { RatingRequestsSwitchPort } from '../../../ports/rating-requests-switch.port.ts';
import { ClaimRatingRequest, type ClaimRatingRequestPorts } from '../claim-rating-request.ts';

const tx = {} as Tx;
const now = new Date('2026-10-05T13:30:00Z');
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
  sendDeadline: new Date('2026-10-05T19:30:00Z'),
  status: 'SCHEDULED',
};

const customer: RatingCustomer = {
  id: customerId,
  name: 'فاطمة علي',
  phone: '+96550000000',
  locale: 'ar',
  optedOutAt: null,
};

const lines: ActiveLine[] = [
  {
    lineId: 'line-1',
    sessionId: 'session-1',
    branchId,
    occurredAt: new Date('2026-10-05T12:10:00Z'),
    recordedAt: new Date('2026-10-05T12:10:00Z'),
    businessTimezone: 'Asia/Kuwait',
    performers: [{ employeeId, shareBps: 10_000 }],
  },
];

const earlyLines: ActiveLine[] = [
  {
    lineId: 'line-0',
    sessionId: 'session-0',
    branchId,
    occurredAt: new Date('2026-10-05T11:00:00Z'),
    recordedAt: new Date('2026-10-05T11:00:00Z'),
    businessTimezone: 'Asia/Kuwait',
    performers: [{ employeeId, shareBps: 10_000 }],
  },
];

function ports(overrides: Partial<ClaimRatingRequestPorts> = {}): ClaimRatingRequestPorts {
  const switchPort: RatingRequestsSwitchPort = { enabled: async () => true };
  const hours: BranchScheduleHoursPort = {
    hours: async () => ({
      openingHours: [{ weekday: 1, intervals: [{ opens: '09:00', closes: '22:00' }] }],
      timeZone: 'Asia/Kuwait',
    }),
  };
  const names: BusinessNamesPort = {
    names: async () => ({ name_ar: 'مطعم البحر', name_en: 'Sea Restaurant' }),
  };
  const daySessions: DaySessionsPort = {
    activeLines: async () => lines,
    sessionsSince: async () => [],
    countSince: async () => 0,
    watermark: async () => null,
  };
  const performers: PerformerNamePort = {
    firstNames: async () => [{ employeeId, nameAr: 'أحمد', nameEn: 'Ahmed' }],
  };
  const label: PerformerLabelPort = {
    format: (choice) => (choice.kind === 'TEAM' ? 'TEAM' : choice.names.join('|')),
    businessName: ratingBusinessName,
  };
  const claims: RatingClaimRepository = {
    due: async () => [],
    lockCustomer: async () => customer,
    lockRequest: async () => stored,
    reschedule: async () => undefined,
    cancel: async () => undefined,
    claim: async () => undefined,
    snapshotPerformers: async () => undefined,
  };
  const token: RatingTokenPort = {
    claim: () => ({ tokenHash: new Uint8Array(32), keyVersion: 1 }),
  };
  const outbox: RatingOutboxPort = { append: async () => undefined };
  return {
    switch: switchPort,
    hours,
    names,
    daySessions,
    performers,
    label,
    claims,
    token,
    outbox,
    ...overrides,
  };
}

const ids: IdGenerator = {
  newId: (() => {
    let counter = 0;
    return () => `01920000-0000-7000-8000-${String(counter++).padStart(12, '0')}`;
  })(),
};

const clock: Clock = { now: () => now };

function useCase(
  overrides: Partial<ClaimRatingRequestPorts> = {},
  clockOverride: Clock = clock,
): ClaimRatingRequest {
  return new ClaimRatingRequest(ports(overrides), ids, clockOverride);
}

describe('claim rating request outcome', () => {
  it('claims a due request and publishes the ready event', async () => {
    const events: { id: string; event: { eventType: string; payload: unknown } }[] = [];
    const claim = useCase({
      outbox: {
        append: async (_tx, id, event) => {
          events.push({ id, event });
        },
      },
    });
    expect(await claim.execute(tx, { companyId, request: stored })).toBe('CLAIMED');
    expect(events).toHaveLength(1);
    expect(events[0]?.event.eventType).toBe('RatingRequestReady');
  });

  it('skips a request another worker already claimed', async () => {
    const base = ports();
    const claim = useCase({
      claims: { ...base.claims, lockRequest: async () => ({ ...stored, status: 'SENDING' }) },
    });
    expect(await claim.execute(tx, { companyId, request: stored })).toBe('NOT_DUE');
  });

  it('cancels the request when the customer opted out', async () => {
    const reasons: string[] = [];
    const base = ports();
    const claim = useCase({
      claims: {
        ...base.claims,
        lockCustomer: async () => ({ ...customer, optedOutAt: new Date('2026-10-05T12:00:00Z') }),
        cancel: async (_tx, _companyId, _requestId, reason) => {
          reasons.push(reason);
        },
      },
    });
    expect(await claim.execute(tx, { companyId, request: stored })).toBe('OPTED_OUT');
    expect(reasons).toEqual(['OPTED_OUT']);
  });

  it('cancels the request when the rating switch is off', async () => {
    const reasons: string[] = [];
    const base = ports();
    const claim = useCase({
      switch: { enabled: async () => false },
      claims: {
        ...base.claims,
        cancel: async (_tx, _companyId, _requestId, reason) => {
          reasons.push(reason);
        },
      },
    });
    expect(await claim.execute(tx, { companyId, request: stored })).toBe('REQUESTS_OFF');
    expect(reasons).toEqual(['REQUESTS_OFF']);
  });

  it('leaves the request scheduled when the token capability is not ready', async () => {
    const claim = useCase({ token: { claim: () => null } });
    expect(await claim.execute(tx, { companyId, request: stored })).toBe('TOKEN_UNAVAILABLE');
  });
});

describe('claim rating request order', () => {
  it('reads the clock after the customer and the request are locked', async () => {
    const order: string[] = [];
    const base = ports();
    const claim = useCase(
      {
        claims: {
          ...base.claims,
          lockCustomer: async () => {
            order.push('lockCustomer');
            return customer;
          },
          lockRequest: async () => {
            order.push('lockRequest');
            return stored;
          },
        },
      },
      {
        now: () => {
          order.push('clock');
          return now;
        },
      },
    );
    await claim.execute(tx, { companyId, request: stored });
    expect(order).toEqual(['lockCustomer', 'lockRequest', 'clock']);
  });
});

describe('claim rating request terminal read order', () => {
  function unreadableDayState(base: ClaimRatingRequestPorts) {
    return {
      hours: {
        hours: async () => {
          throw new Error('DAY_STATE_READ_MUST_NOT_RUN');
        },
      },
      daySessions: {
        ...base.daySessions,
        activeLines: async () => {
          throw new Error('DAY_STATE_READ_MUST_NOT_RUN');
        },
      },
    };
  }

  it('commits opt-out before reading the switch or day state', async () => {
    const base = ports();
    const claim = useCase({
      ...unreadableDayState(base),
      switch: {
        enabled: async () => {
          throw new Error('SWITCH_READ_MUST_NOT_RUN');
        },
      },
      claims: {
        ...base.claims,
        lockCustomer: async () => ({ ...customer, optedOutAt: new Date('2026-10-05T12:00:00Z') }),
      },
    });
    await expect(claim.execute(tx, { companyId, request: stored })).resolves.toBe('OPTED_OUT');
  });

  it('commits a switched-off request before reading day state', async () => {
    const base = ports();
    const claim = useCase({
      ...unreadableDayState(base),
      switch: { enabled: async () => false },
    });
    await expect(claim.execute(tx, { companyId, request: stored })).resolves.toBe('REQUESTS_OFF');
  });

  it('commits a stored-deadline cancellation before reading day state', async () => {
    const base = ports();
    const claim = useCase({
      ...unreadableDayState(base),
      claims: {
        ...base.claims,
        lockRequest: async () => ({
          ...stored,
          sendDeadline: new Date('2026-10-05T13:29:59Z'),
        }),
      },
    });
    await expect(claim.execute(tx, { companyId, request: stored })).resolves.toBe('PAST_DEADLINE');
  });
});

describe('claim rating request schedule', () => {
  it('claims with the recomputed schedule when the moved due time already passed', async () => {
    const claims: { branchId: string; dueAt: Date; sendDeadline: Date | null }[] = [];
    const events: { event: { payload: unknown } }[] = [];
    const base = ports();
    const claim = useCase({
      daySessions: { ...base.daySessions, activeLines: async () => earlyLines },
      claims: {
        ...base.claims,
        claim: async (_tx, _companyId, _requestId, value) => {
          claims.push(value);
        },
      },
      outbox: {
        append: async (_tx, _id, event) => {
          events.push({ event });
        },
      },
    });
    expect(await claim.execute(tx, { companyId, request: stored })).toBe('CLAIMED');
    expect(claims[0]).toMatchObject({
      branchId,
      dueAt: new Date('2026-10-05T12:00:00Z'),
      sendDeadline: new Date('2026-10-05T19:30:00Z'),
    });
    const payload = events[0]?.event.payload as {
      branch_id: string;
      notification_recipients: { send_deadline: string | null }[];
    };
    expect(payload.branch_id).toBe(branchId);
    expect(payload.notification_recipients[0]?.send_deadline).toBe('2026-10-05T19:30:00.000Z');
  });
});

describe('claim rating request business-name contract', () => {
  const supplementary = '😀'.repeat(128);
  const expected = `${'😀'.repeat(127)}…`;

  it.each([
    {
      scenario: 'arabic localized name',
      locale: 'ar' as const,
      names: { name_ar: supplementary, name_en: 'Sea Restaurant' },
    },
    {
      scenario: 'english localized name',
      locale: 'en' as const,
      names: { name_ar: 'مطعم البحر', name_en: supplementary },
    },
    {
      scenario: 'arabic fallback to english',
      locale: 'ar' as const,
      names: { name_ar: null, name_en: supplementary },
    },
  ])('keeps the $scenario within the notification contract', async ({ locale, names }) => {
    let ready: RatingRequestReady | undefined;
    const claim = useCase({
      names: { names: async () => names },
      claims: {
        ...ports().claims,
        lockCustomer: async () => ({ ...customer, locale }),
      },
      outbox: {
        append: async (_tx, _id, event) => {
          ready = event.payload as RatingRequestReady;
        },
      },
    });

    await expect(claim.execute(tx, { companyId, request: stored })).resolves.toBe('CLAIMED');
    const parameter = ready?.notification_recipients[0]?.safe_parameters.find(
      (candidate) => candidate.name === 'business_name',
    );
    if (parameter?.type !== 'text' || typeof parameter.value !== 'string') {
      throw new Error('BUSINESS_NAME_PARAMETER_MISSING');
    }
    expect(parameter.value).toBe(expected);
    expect(parameter.value).toHaveLength(255);
    expect(ready).toBeDefined();
  });
});
