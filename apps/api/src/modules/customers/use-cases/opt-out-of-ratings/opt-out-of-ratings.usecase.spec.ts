import { describe, expect, it } from 'vitest';

import type { AuditRecord } from '../../../../shared/ports/audit-trail.port.ts';
import type {
  RatingOptOutScope,
  RatingOptOutTransactions,
  RatingRequestRef,
} from '../../ports/rating-opt-out.port.ts';
import type { RatingTokenHash } from '../../ports/rating-token-hash.port.ts';
import { OptOutOfRatingsUseCase } from './opt-out-of-ratings.usecase.ts';

const COMPANY = '01920000-0000-7000-8000-000000000aa1';
const CUSTOMER = '01920000-0000-7000-8000-000000000bb1';
const TOKEN = `${COMPANY}.${'A'.repeat(43)}`;
const EXPIRES_AT = new Date('2026-06-08T00:00:00Z');
const NOW = new Date('2026-06-02T00:00:00Z');

interface Fakes {
  readonly calls: string[];
  readonly audits: AuditRecord[];
  readonly hashed: string[];
  readonly transactions: RatingOptOutTransactions;
}

function fakes(
  options: {
    request?: RatingRequestRef | null;
    customer?: { readonly optedOutAt: Date | null } | null;
    written?: boolean;
    now?: Date;
  } = {},
): Fakes {
  const calls: string[] = [];
  const audits: AuditRecord[] = [];
  const hashed: string[] = [];
  const request =
    'request' in options
      ? options.request
      : ({ customerId: CUSTOMER, expiresAt: EXPIRES_AT } satisfies RatingRequestRef);
  const customer =
    'customer' in options ? options.customer : ({ optedOutAt: null } as { optedOutAt: Date | null });
  const scope: RatingOptOutScope = {
    audit: {
      record: async (entry) => {
        calls.push('audit');
        audits.push(entry);
      },
    },
    findRequest: async () => {
      calls.push('findRequest');
      return request;
    },
    lockCustomer: async () => {
      calls.push('lockCustomer');
      return customer;
    },
    markOptedOut: async () => {
      calls.push('markOptedOut');
      return options.written ?? true;
    },
  };
  const transactions: RatingOptOutTransactions = {
    run: async (_companyId, work) => work(scope),
  };
  return { calls, audits, hashed, transactions };
}

function useCase(fake: Fakes, now: Date = NOW): OptOutOfRatingsUseCase {
  const hash: RatingTokenHash = {
    sha256: (token) => {
      fake.hashed.push(token);
      return Buffer.from(token, 'utf8');
    },
  };
  return new OptOutOfRatingsUseCase(fake.transactions, hash, { now: () => now });
}

describe('opting out of the rating messages', () => {
  it('marks the customer and writes one audit row', async () => {
    const fake = fakes();
    const outcome = await useCase(fake).execute({ token: TOKEN });
    expect(outcome).toBe('ACCEPTED');
    expect(fake.calls).toEqual(['findRequest', 'lockCustomer', 'markOptedOut', 'audit']);
    expect(fake.audits).toEqual([
      {
        entity: 'customer',
        entityId: CUSTOMER,
        action: 'rating_opted_out',
        after: { opted_out_at: NOW.toISOString() },
      },
    ]);
  });

  it('reads the request before the lock and the clock after it', async () => {
    const fake = fakes();
    await useCase(fake).execute({ token: TOKEN });
    expect(fake.calls.indexOf('findRequest')).toBeLessThan(fake.calls.indexOf('lockCustomer'));
    expect(fake.calls.indexOf('lockCustomer')).toBeLessThan(fake.calls.indexOf('markOptedOut'));
  });
});

describe('refusing an unusable rating link', () => {
  it('refuses a malformed token without touching the database', async () => {
    const fake = fakes();
    const outcome = await useCase(fake).execute({ token: 'not-a-token' });
    expect(outcome).toBe('UNAVAILABLE');
    expect(fake.calls).toEqual([]);
    expect(fake.hashed).toEqual([]);
  });

  it('refuses an unknown token', async () => {
    const fake = fakes({ request: null });
    const outcome = await useCase(fake).execute({ token: TOKEN });
    expect(outcome).toBe('UNAVAILABLE');
    expect(fake.calls).toEqual(['findRequest']);
  });

  it('refuses a missing customer row', async () => {
    const fake = fakes({ customer: null });
    const outcome = await useCase(fake).execute({ token: TOKEN });
    expect(outcome).toBe('UNAVAILABLE');
    expect(fake.calls).toEqual(['findRequest', 'lockCustomer']);
  });

  it('refuses a link that expired before the decision', async () => {
    const fake = fakes();
    const outcome = await useCase(fake, new Date(EXPIRES_AT.getTime())).execute({ token: TOKEN });
    expect(outcome).toBe('UNAVAILABLE');
    expect(fake.calls).toEqual(['findRequest', 'lockCustomer']);
  });

  it('refuses a link that expired after the lock was taken', async () => {
    const fake = fakes();
    const outcome = await useCase(fake, new Date(EXPIRES_AT.getTime() + 1)).execute({ token: TOKEN });
    expect(outcome).toBe('UNAVAILABLE');
    expect(fake.calls).toEqual(['findRequest', 'lockCustomer']);
  });
});

describe('not repeating the opt-out write', () => {
  it('does not write again when the customer already opted out', async () => {
    const fake = fakes({ customer: { optedOutAt: new Date('2026-06-01T00:00:00Z') } });
    const outcome = await useCase(fake).execute({ token: TOKEN });
    expect(outcome).toBe('ACCEPTED');
    expect(fake.calls).toEqual(['findRequest', 'lockCustomer']);
    expect(fake.audits).toEqual([]);
  });

  it('writes no audit when the row was already taken', async () => {
    const fake = fakes({ written: false });
    const outcome = await useCase(fake).execute({ token: TOKEN });
    expect(outcome).toBe('ACCEPTED');
    expect(fake.calls).toEqual(['findRequest', 'lockCustomer', 'markOptedOut']);
    expect(fake.audits).toEqual([]);
  });
});
