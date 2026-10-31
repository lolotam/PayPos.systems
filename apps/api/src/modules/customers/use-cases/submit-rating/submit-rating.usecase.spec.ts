import { describe, expect, it } from 'vitest';

import type {
  ConsumeAndRateInput,
  RatingSubmitScope,
  RatingSubmitTransactions,
} from '../../ports/rating-submission.port.ts';
import type { RatingTokenHash } from '../../ports/rating-token-hash.port.ts';
import { SubmitRatingUseCase } from './submit-rating.usecase.ts';

const COMPANY = '01920000-0000-7000-8000-000000000aa1';
const TOKEN = `${COMPANY}.${'A'.repeat(43)}`;
const NOW = new Date('2026-06-02T00:00:00Z');

interface Fakes {
  readonly calls: string[];
  readonly hashed: string[];
  readonly runs: number;
  readonly consumed: ConsumeAndRateInput[];
  readonly transactions: RatingSubmitTransactions;
}

function fakes(options: { locked?: boolean; consumed?: boolean } = {}): Fakes {
  const calls: string[] = [];
  const hashed: string[] = [];
  const consumed: ConsumeAndRateInput[] = [];
  let runs = 0;
  const scope: RatingSubmitScope = {
    lockRequest: async () => {
      calls.push('lockRequest');
      return options.locked ?? true;
    },
    consumeAndRate: async (input) => {
      calls.push('consumeAndRate');
      consumed.push(input);
      return options.consumed ?? true;
    },
  };
  const transactions: RatingSubmitTransactions = {
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
    consumed,
    transactions,
  };
}

function useCase(fake: Fakes, now: Date = NOW): SubmitRatingUseCase {
  const hash: RatingTokenHash = {
    sha256: (token) => {
      fake.hashed.push(token);
      return Buffer.from(token, 'utf8');
    },
  };
  return new SubmitRatingUseCase(fake.transactions, hash, {
    now: () => {
      fake.calls.push('clock');
      return now;
    },
  });
}

describe('submitting a rating', () => {
  it('consumes the link and stores the stars', async () => {
    const fake = fakes();
    const outcome = await useCase(fake).execute({ token: TOKEN, body: { stars: 5 } });
    expect(outcome).toBe('SUBMITTED');
    expect(fake.calls).toEqual(['lockRequest', 'clock', 'consumeAndRate']);
    expect(fake.consumed).toHaveLength(1);
    expect(fake.consumed[0]?.stars).toBe(5);
    expect(fake.consumed[0]?.comment).toBeNull();
    expect(fake.consumed[0]?.now).toEqual(NOW);
  });

  it('stores an empty comment as no comment', async () => {
    const fake = fakes();
    const outcome = await useCase(fake).execute({ token: TOKEN, body: { stars: 4, comment: '' } });
    expect(outcome).toBe('SUBMITTED');
    expect(fake.consumed[0]?.comment).toBeNull();
  });

  it('stores the comment the customer wrote', async () => {
    const fake = fakes();
    const outcome = await useCase(fake).execute({
      token: TOKEN,
      body: { stars: 3, comment: 'خدمة كويسة' },
    });
    expect(outcome).toBe('SUBMITTED');
    expect(fake.consumed[0]?.comment).toBe('خدمة كويسة');
  });

  it('reads the clock after the lock, not before', async () => {
    const fake = fakes();
    await useCase(fake).execute({ token: TOKEN, body: { stars: 5 } });
    expect(fake.calls.indexOf('lockRequest')).toBeLessThan(fake.calls.indexOf('clock'));
    expect(fake.calls.indexOf('clock')).toBeLessThan(fake.calls.indexOf('consumeAndRate'));
  });
});

describe('refusing an invalid rating body', () => {
  it.each([
    { label: 'a non-integer star count', body: { stars: 2.5 } },
    { label: 'a star count below the range', body: { stars: 0 } },
    { label: 'a star count above the range', body: { stars: 6 } },
    { label: 'a missing star count', body: {} },
    {
      label: 'an unknown field',
      body: { stars: 5, employee_ids: ['01920000-0000-7000-8000-000000000cc1'] },
    },
    { label: 'a comment with a link', body: { stars: 5, comment: 'شوف https://example.com' } },
    { label: 'a comment with a bare domain', body: { stars: 5, comment: 'example.com' } },
    { label: 'a body that is not an object', body: 'stars' },
  ])('refuses $label without opening a transaction', async ({ body }) => {
    const fake = fakes();
    const outcome = await useCase(fake).execute({ token: TOKEN, body });
    expect(outcome).toBe('INVALID');
    expect(fake.runs).toBe(0);
    expect(fake.calls).toEqual([]);
  });
});

describe('refusing an unusable rating link', () => {
  it('refuses a malformed token without opening a transaction', async () => {
    const fake = fakes();
    const outcome = await useCase(fake).execute({ token: 'not-a-token', body: { stars: 5 } });
    expect(outcome).toBe('UNAVAILABLE');
    expect(fake.runs).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it('refuses a link with no request behind it', async () => {
    const fake = fakes({ locked: false });
    const outcome = await useCase(fake).execute({ token: TOKEN, body: { stars: 5 } });
    expect(outcome).toBe('UNAVAILABLE');
    expect(fake.calls).toEqual(['lockRequest']);
    expect(fake.consumed).toEqual([]);
  });

  it('writes nothing when the request could not be consumed', async () => {
    const fake = fakes({ consumed: false });
    const outcome = await useCase(fake).execute({ token: TOKEN, body: { stars: 5 } });
    expect(outcome).toBe('UNAVAILABLE');
    expect(fake.calls).toEqual(['lockRequest', 'clock', 'consumeAndRate']);
  });
});
