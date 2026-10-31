import { describe, expect, it } from 'vitest';

import type { AuditRecord } from '../../../../shared/ports/audit-trail.port.ts';
import type {
  RatingSettingsScope,
  RatingSettingsTransactions,
  SaveRatingSettingsInput,
} from '../../ports/rating-settings.port.ts';
import { SetRatingRequests } from './set-rating-requests.usecase.ts';

const COMPANY = '01920000-0000-7000-8000-000000000aa1';
const USER = '01920000-0000-7000-8000-000000000bb1';
const BUSINESS = '01920000-0000-7000-8000-000000000cc1';
const NOW = new Date('2026-10-30T00:00:00Z');

interface Fakes {
  readonly audits: AuditRecord[];
  readonly saved: SaveRatingSettingsInput[];
  readonly transactions: RatingSettingsTransactions;
}

function fakes(options: { stored?: boolean | null } = {}): Fakes {
  const audits: AuditRecord[] = [];
  const saved: SaveRatingSettingsInput[] = [];
  let stored = 'stored' in options ? options.stored : null;
  const scope: RatingSettingsScope = {
    audit: {
      record: async (entry) => {
        audits.push(entry);
      },
    },
    save: async (input) => {
      saved.push(input);
      const before = stored;
      stored = input.enabled;
      return { before: before ?? null };
    },
  };
  const transactions: RatingSettingsTransactions = {
    run: async (companyId, userId, work) => {
      if (companyId !== COMPANY) throw new Error('wrong company');
      if (userId !== USER) throw new Error('wrong user');
      return work(scope);
    },
  };
  return { audits, saved, transactions };
}

function useCase(fake: Fakes, now: Date = NOW): SetRatingRequests {
  return new SetRatingRequests(fake.transactions, { now: () => now });
}

describe('set-rating-requests', () => {
  it('a first write audits a null before and returns the new value', async () => {
    const fake = fakes();
    const result = await useCase(fake).execute(
      { companyId: COMPANY, userId: USER },
      BUSINESS,
      true,
    );
    expect(result).toEqual({ requests_enabled: true });
    expect(fake.audits).toEqual([
      {
        entity: 'rating_settings',
        entityId: BUSINESS,
        action: 'customer.rating_requests_switched',
        before: { requests_enabled: null },
        after: { requests_enabled: true },
      },
    ]);
  });

  it('a second write audits the value it replaced', async () => {
    const fake = fakes({ stored: true });
    await useCase(fake).execute({ companyId: COMPANY, userId: USER }, BUSINESS, false);
    expect(fake.audits[0]).toMatchObject({
      before: { requests_enabled: true },
      after: { requests_enabled: false },
    });
  });

  it('the saved row carries the actor and the injected clock', async () => {
    const fake = fakes();
    await useCase(fake).execute({ companyId: COMPANY, userId: USER }, BUSINESS, true);
    expect(fake.saved).toEqual([{ businessId: BUSINESS, enabled: true, actorId: USER, now: NOW }]);
  });
});
