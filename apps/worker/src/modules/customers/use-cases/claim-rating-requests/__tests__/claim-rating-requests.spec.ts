import { describe, expect, it } from 'vitest';
import type { Tx } from '@pospay/db';

import type { Clock, IdGenerator } from '../../../ports/clock.port.ts';
import type {
  DueRatingCursor,
  DueRatingRequest,
  RatingClaimRepository,
} from '../../../ports/rating-claim.repository.ts';
import type { RatingClaimTransactions } from '../../../ports/rating-claim-transactions.port.ts';
import { ClaimRatingRequest } from '../../claim-rating-request/claim-rating-request.ts';
import { ClaimRatingRequests } from '../claim-rating-requests.ts';

const tx = {} as Tx;
const now = new Date('2026-10-05T13:30:00Z');
const companyId = '01920000-0000-7000-8000-0000000000b2';
const ids: IdGenerator = { newId: () => '01920000-0000-7000-8000-0000000000ff' };
const clock: Clock = { now: () => now };

function identifier(prefix: number, index: number): string {
  return `01920000-0000-7000-8000-${String(prefix + index).padStart(12, '0')}`;
}

function dueRequest(index: number): DueRatingRequest {
  return {
    id: identifier(1, index),
    businessId: '01920000-0000-7000-8000-0000000000c3',
    customerId: identifier(2, index),
    businessDate: '2026-10-05',
    branchId: '01920000-0000-7000-8000-0000000000d4',
    dueAt: new Date(now.getTime() - 60_000 + index * 1_000),
    sendDeadline: new Date('2026-10-05T19:30:00Z'),
    status: 'SCHEDULED',
  };
}

/** معاملات بتدي صفحات جاهزة وتسجّل المؤشر اللي كل صفحة طلبته. */
function fakeTransactions(pages: readonly (readonly DueRatingRequest[])[]) {
  const cursors: (DueRatingCursor | null)[] = [];
  const transactions: RatingClaimTransactions = {
    due: async (_companyId, _now, _limit, after) => {
      cursors.push(after);
      return pages[cursors.length - 1] ?? [];
    },
    claim: async (_companyId, work) => {
      await work(tx);
    },
  };
  return { transactions, cursors };
}

/** مطالبة بطلب واحد: بتوقف عند قفل العميل، فقرارات المطالبة نفسها مش جزء من اختبار الجولة. */
function fakeClaim(failing: readonly string[]) {
  const attempted: string[] = [];
  const claims: RatingClaimRepository = {
    due: async () => [],
    lockCustomer: async (_tx, _companyId, customerId) => {
      attempted.push(customerId);
      if (failing.includes(customerId)) throw new Error('RATING_BRANCH_NOT_FOUND');
      return null;
    },
    lockRequest: async () => null,
    reschedule: async () => undefined,
    cancel: async () => undefined,
    claim: async () => undefined,
    snapshotPerformers: async () => undefined,
  };
  const useCase = new ClaimRatingRequest(
    {
      switch: { enabled: async () => true },
      hours: { hours: async () => null },
      names: { names: async () => null },
      daySessions: {
        activeLines: async () => [],
        sessionsSince: async () => [],
        countSince: async () => 0,
        watermark: async () => null,
      },
      performers: { firstNames: async () => [] },
      label: { format: () => 'LABEL' },
      claims,
      token: { claim: () => null },
      outbox: { append: async () => undefined },
    },
    ids,
    clock,
  );
  return { useCase, attempted };
}

describe('claim rating requests paging', () => {
  it('walks the pages by the key of the page before', async () => {
    const first = Array.from({ length: 100 }, (_, index) => dueRequest(index));
    const second = [dueRequest(100), dueRequest(101)];
    const pages = fakeTransactions([first, second]);
    const batch = new ClaimRatingRequests(pages.transactions, fakeClaim([]).useCase, clock);
    await batch.execute(companyId);
    expect(pages.cursors).toHaveLength(2);
    expect(pages.cursors[0]).toBeNull();
    expect(pages.cursors[1]).toEqual({ dueAt: first[99]?.dueAt, id: first[99]?.id });
  });

  it('stops on the page that comes back short', async () => {
    const pages = fakeTransactions([[dueRequest(0), dueRequest(1)]]);
    const batch = new ClaimRatingRequests(pages.transactions, fakeClaim([]).useCase, clock);
    await batch.execute(companyId);
    expect(pages.cursors).toHaveLength(1);
  });
});

describe('claim rating requests failure isolation', () => {
  it('claims the other requests when one of them fails', async () => {
    const requests = [dueRequest(0), dueRequest(1), dueRequest(2)];
    const failing = requests[1]?.customerId ?? '';
    const pages = fakeTransactions([requests]);
    const claim = fakeClaim([failing]);
    const batch = new ClaimRatingRequests(pages.transactions, claim.useCase, clock);
    const error = await batch.execute(companyId).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(claim.attempted).toEqual(requests.map((request) => request.customerId));
    expect((error as Error).message).toBe('RATING_CLAIMS_FAILED_1');
  });

  it('names only the count of the failed requests', async () => {
    const requests = [dueRequest(0), dueRequest(1)];
    const failing = requests.map((request) => request.customerId);
    const pages = fakeTransactions([requests]);
    const batch = new ClaimRatingRequests(pages.transactions, fakeClaim(failing).useCase, clock);
    const error = await batch.execute(companyId).catch((reason: unknown) => reason);
    expect((error as Error).message).toBe('RATING_CLAIMS_FAILED_2');
    expect((error as Error).message).not.toContain(requests[0]?.id ?? '');
    expect((error as Error).message).not.toContain(requests[0]?.customerId ?? '');
  });
});
