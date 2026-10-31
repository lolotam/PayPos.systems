import { describe, expect, it } from 'vitest';

import type { BusinessNames } from '../../ports/business-names.port.ts';
import type {
  RatingViewScope,
  RatingViewTransactions,
  RatingViewRow,
} from '../../ports/rating-submission.port.ts';
import type { RatingTokenHash } from '../../ports/rating-token-hash.port.ts';
import { ViewRatingUseCase } from './view-rating.usecase.ts';

const COMPANY = '01920000-0000-7000-8000-000000000aa1';
const TOKEN = `${COMPANY}.${'A'.repeat(43)}`;
const EXPIRES_AT = new Date('2026-06-08T00:00:00Z');
const NOW = new Date('2026-06-02T00:00:00Z');
const BUSINESS = '01920000-0000-7000-8000-0000000000a1';

interface Fakes {
  readonly calls: string[];
  readonly hashed: string[];
  readonly runs: number;
  readonly transactions: RatingViewTransactions;
}

function fakes(options: { row?: RatingViewRow | null; names?: BusinessNames | null } = {}): Fakes {
  const calls: string[] = [];
  const hashed: string[] = [];
  let runs = 0;
  const row =
    'row' in options
      ? options.row
      : ({
          expiresAt: EXPIRES_AT,
          consumedAt: null,
          locale: 'ar',
          businessId: BUSINESS,
        } satisfies RatingViewRow);
  const names =
    'names' in options ? options.names : { name_ar: 'صالون النخيل', name_en: 'Palm Salon' };
  const scope: RatingViewScope = {
    findView: async () => {
      calls.push('findView');
      return row;
    },
    businessNames: async () => {
      calls.push('businessNames');
      return names;
    },
  };
  const transactions: RatingViewTransactions = {
    run: async (_companyId, work) => {
      runs += 1;
      return work(scope);
    },
  };
  return {
    calls,
    hashed,
    get runs() {
      return runs;
    },
    transactions,
  };
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
    expect(fake.calls).toEqual(['findView', 'businessNames']);
  });

  it('shows the English name when the Arabic one is missing', async () => {
    const fake = fakes({ names: { name_ar: null, name_en: 'Palm Salon' } });
    const outcome = await useCase(fake).execute({ token: TOKEN });
    expect(outcome).toEqual({ business_name: 'Palm Salon', state: 'open' });
  });

  it('shows a consumed link as submitted without touching anything', async () => {
    const fake = fakes({
      row: {
        expiresAt: EXPIRES_AT,
        consumedAt: new Date('2026-06-02T00:00:00Z'),
        locale: 'en',
        businessId: BUSINESS,
      },
      names: { name_ar: 'صالون النخيل', name_en: 'Palm Salon' },
    });
    const outcome = await useCase(fake).execute({ token: TOKEN });
    expect(outcome).toEqual({ business_name: 'Palm Salon', state: 'submitted' });
    expect(fake.calls).toEqual(['findView', 'businessNames']);
  });
});

describe('refusing an unusable rating link', () => {
  it('refuses a malformed token without opening a transaction', async () => {
    const fake = fakes();
    const outcome = await useCase(fake).execute({ token: 'not-a-token' });
    expect(outcome).toBe('UNAVAILABLE');
    expect(fake.runs).toBe(0);
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

  it('refuses a link whose business is gone', async () => {
    const fake = fakes({ names: null });
    const outcome = await useCase(fake).execute({ token: TOKEN });
    expect(outcome).toBe('UNAVAILABLE');
    expect(fake.calls).toEqual(['findView', 'businessNames']);
  });
});

describe('the view scope stays read-only', () => {
  it('cannot lock the request or write the rating from it', () => {
    const scope: RatingViewScope = {
      findView: async () => null,
      businessNames: async () => null,
    };
    // @ts-expect-error the view scope has no lock: the page may only read (PP-87.1).
    const lock = scope.lockRequest;
    // @ts-expect-error the view scope has no write: the page may only read (PP-87.1).
    const consume = scope.consumeAndRate;
    expect([lock, consume]).toEqual([undefined, undefined]);
  });
});
