import { describe, expect, it } from 'vitest';

import type { RatingSentRepository } from '../../../ports/rating-sent.repository.ts';
import { RecordRatingRequestSent } from '../record-rating-request-sent.ts';

const COMPANY = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b';
const EVENT = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c';
const SENT_AT = new Date('2026-06-01T14:05:00.000Z');

function fakeRepository(result: boolean) {
  const calls: unknown[][] = [];
  const repository: RatingSentRepository<string> = {
    markSent: async (...args) => {
      calls.push(args);
      return result;
    },
  };
  return { repository, calls };
}

describe('RecordRatingRequestSent', () => {
  it('forwards company, ready event and acceptance time and reports the transition', async () => {
    const { repository, calls } = fakeRepository(true);
    const moved = await new RecordRatingRequestSent(repository).execute('tx', {
      companyId: COMPANY,
      readyEventId: EVENT,
      sentAt: SENT_AT,
    });
    expect(moved).toBe(true);
    expect(calls).toEqual([['tx', COMPANY, EVENT, SENT_AT]]);
  });

  it('reports no transition when the request is not SENDING or the event was already applied', async () => {
    const { repository } = fakeRepository(false);
    const moved = await new RecordRatingRequestSent(repository).execute('tx', {
      companyId: COMPANY,
      readyEventId: EVENT,
      sentAt: SENT_AT,
    });
    expect(moved).toBe(false);
  });
});
