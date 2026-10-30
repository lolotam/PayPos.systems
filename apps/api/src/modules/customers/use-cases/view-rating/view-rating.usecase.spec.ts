import { describe, expect, it } from 'vitest';

import type {
  RatingSubmissionScope,
  RatingSubmissionTransactions,
  RatingViewRow,
} from '../../ports/rating-submission.port.ts';
import type { RatingTokenHash } from '../../ports/rating-token-hash.port.ts';
import { ViewRatingUseCase } from './view-rating.usecase.ts';

const COMPANY = '01920000-0000-7000-8000-000000000aa1';
const TOKEN = `${COMPANY}.${'A'.repeat(43)}`;
const EXPIRES_AT = new Date('2026-06-08T00:00:00Z');
const NOW = new Date('2026-06-02T00:00:00Z');

interface Fakes {
  readonly calls: string[];
  readonly hashed: string[];
  readonly transactions: RatingSubmissionTransactions;
}

function fakes(options: { row?: RatingViewRow | null } = {}): Fakes {
  const calls: string[] = [];
  const hashed: string[] = [];
  const row =
    'row' in options
      ? options.row
      : ({
          expiresAt: EXPIRES_AT,
          consumedAt: null,
          locale: 'ar',
          nameAr: 'صالون النخيل',
          nameEn: 'Palm Salon',
        } satisfies RatingViewRow);
  const scope: RatingSubmissionScope = {
    findView: async () => {
      calls.push('findView');
      return row;
    },
    lockRequest: async () => {
      calls.push('lockRequest');
      return true;
    },
    consumeAndRate: async () => {
      calls.push('consumeAndRate');
      return true;
    },
  };
  const transactions: RatingSubmissionTransactions = {
    run: async (_companyId, work) => work(scope),
  };
  return { calls, hashed, transactions };
}

function useCase(fake: Fakes, now: Date = NOW): ViewRatingUseCase {
  const hash: RatingTokenHash = {
    sha256: (token) => {
      fake.hashed.push(token);
      return Buffer.from(token, 'utf8');
    },
  };
  return new ViewRatingUseCase(fake.transactions, hash, { now: () => now });
}

describe('viewing the rating page', () => {
  it('shows the business name in the customer language and an open link', async () => {
    const fake = fakes();
    const outcome = await useCase(fake).execute({ token: TOKEN });
    expect(outcome).toEqual({ business_name: 'صالون النخيل', state: 'open' });
    expect(fake.calls).toEqual(['findView']);
  });

  it('shows the English name when the Arabic one is missing', async () => {
    const fake = fakes({
      row: {
        expiresAt: EXPIRES_AT,
        consumedAt: null,
        locale: 'ar',
        nameAr: null,
        nameEn: 'Palm Salon',
      },
    });
    const outcome = await useCase(fake).execute({ token: TOKEN });
    expect(outcome).toEqual({ business_name: 'Palm Salon', state: 'open' });
  });

  it('shows a consumed link as submitted without touching anything', async () => {
    const fake = fakes({
      row: {
        expiresAt: EXPIRES_AT,
        consumedAt: new Date('2026-06-02T00:00:00Z'),
        locale: 'en',
        nameAr: 'صالون النخيل',
        nameEn: 'Palm Salon',
      },
    });
    const outcome = await useCase(fake).execute({ token: TOKEN });
    expect(outcome).toEqual({ business_name: 'Palm Salon', state: 'submitted' });
    expect(fake.calls).toEqual(['findView']);
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
    const fake = fakes({ row: null });
    const outcome = await useCase(fake).execute({ token: TOKEN });
    expect(outcome).toBe('UNAVAILABLE');
    expect(fake.calls).toEqual(['findView']);
  });

  it('refuses an expired link', async () => {
    const fake = fakes();
    const outcome = await useCase(fake, EXPIRES_AT).execute({ token: TOKEN });
    expect(outcome).toBe('UNAVAILABLE');
    expect(fake.calls).toEqual(['findView']);
  });
});
