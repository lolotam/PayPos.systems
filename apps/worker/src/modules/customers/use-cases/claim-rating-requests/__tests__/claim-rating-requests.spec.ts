import { describe, expect, it } from 'vitest';

import type { Clock, IdGenerator } from '../../../ports/clock.port.ts';
import type { RatingClaimDiagnostics } from '../../../ports/rating-claim-diagnostics.port.ts';
import type { DueRatingRequest } from '../../../ports/rating-claim.repository.ts';
import type { RatingClaimTransactions } from '../../../ports/rating-claim-transactions.port.ts';
import type {
  ClaimStateCode,
  ClaimStateFence,
  ClaimStatePage,
  ClaimStatePageEntry,
  ClaimStateReservations,
  ClaimStateResult,
  ClaimStateSnapshot,
  ClaimStateRetry,
  RatingClaimState,
} from '../../../ports/rating-claim-state.port.ts';
import { ClaimRatingRequests, type RatingClaimsPorts } from '../claim-rating-requests.ts';
import type { ClaimRatingRequestInput } from '../../claim-rating-request/claim-rating-request.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000b2';
const BUSINESS = '01920000-0000-7000-8000-0000000000c3';
const CUSTOMER = '01920000-0000-7000-8000-0000000000d4';
const BRANCH = '01920000-0000-7000-8000-0000000000e5';
const NOW = new Date('2026-11-01T08:00:00.000Z');
const PAST = new Date('2026-11-01T07:00:00.000Z');
const FUTURE = new Date('2026-11-01T09:00:00.000Z');

let counter = 0;
const ids: IdGenerator = {
  newId: () => `01920000-0000-7000-8000-${String(counter++).padStart(12, '0')}`,
};
const clock: Clock = { now: () => NOW };

function request(id: string, status: DueRatingRequest['status'], dueAt: Date): DueRatingRequest {
  return {
    id,
    businessId: BUSINESS,
    customerId: CUSTOMER,
    businessDate: '2026-11-01',
    branchId: BRANCH,
    dueAt,
    sendDeadline: null,
    status,
  };
}

/**
 * حالة الجدولة في الذاكرة: بديل Redis في الاختبار، بتسجّل كل أمر في ترتيبه
 * وبتحتفظ بالصفحة والدورة كأنها في Redis.
 */
class FakeState implements RatingClaimState {
  readonly calls: string[] = [];
  readonly settlements: { requestId: string; settlement: string }[] = [];
  version = 1;
  phase: 'IDLE' | 'SWEEP' = 'IDLE';
  sweepId: string | undefined;
  upperId: string | undefined;
  cursorId: string | undefined;
  page: ClaimStatePage | undefined;
  retries: Record<string, ClaimStateRetry> = {};
  reservations: readonly { requestId: string; workToken: string }[] = [];
  acquireCode: ClaimStateCode = 'OK';
  settlePageCode: ClaimStateCode = 'OK';

  private snapshot(): ClaimStateSnapshot {
    return {
      companyId: COMPANY,
      incarnation: 'incarnation-1',
      version: this.version,
      ownerToken: 'owner-1',
      nextTicket: 1,
      phase: this.phase,
      ...(this.sweepId === undefined ? {} : { sweepId: this.sweepId }),
      ...(this.upperId === undefined ? {} : { upperId: this.upperId }),
      ...(this.cursorId === undefined ? {} : { cursorId: this.cursorId }),
      ...(this.page === undefined ? {} : { page: this.page }),
      retries: this.retries,
      overflowCount: 0,
      reconcileRequired: false,
    };
  }

  async acquire(): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('acquire');
    if (this.acquireCode !== 'OK') return { code: this.acquireCode, version: this.version };
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async renew(): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('renew');
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async release(): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('release');
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async begin(
    fence: ClaimStateFence,
    sweepId: string,
    upperId: string | null,
  ): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('begin');
    if (fence.companyId !== COMPANY) return { code: 'STALE', version: this.version };
    this.phase = 'SWEEP';
    this.sweepId = sweepId;
    this.upperId = upperId ?? undefined;
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async enrollPage(
    fence: ClaimStateFence,
    sweepId: string,
    fromId: string | null,
    pageId: string,
    entries: readonly ClaimStatePageEntry[],
    exhausted: boolean,
    _maxEntries: number,
  ): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('enrollPage');
    if (fence.companyId !== COMPANY) return { code: 'STALE', version: this.version };
    const last = entries[entries.length - 1];
    this.page = {
      pageId,
      sweepId,
      exhausted,
      entries,
      ...(fromId === null ? {} : { fromId }),
      ...(last === undefined ? {} : { throughId: last.requestId }),
    };
    if (last !== undefined) this.cursorId = last.requestId;
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async reserveRetries(
    fence: ClaimStateFence,
    limit: number,
    workTokens: readonly string[],
  ): Promise<ClaimStateResult<ClaimStateReservations>> {
    this.calls.push('reserveRetries');
    if (fence.companyId !== COMPANY) return { code: 'STALE', version: this.version };
    this.version += 1;
    return {
      code: 'OK',
      version: this.version,
      value: {
        reservations: this.reservations.slice(0, Math.min(limit, workTokens.length)),
      },
    };
  }

  async settlePage(
    fence: ClaimStateFence,
    pageId: string,
    workToken: string,
    settlement: string,
  ): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('settlePage');
    if (fence.companyId !== COMPANY) return { code: 'STALE', version: this.version };
    if (this.settlePageCode !== 'OK') return { code: this.settlePageCode, version: this.version };
    if (this.page !== undefined && this.page.pageId !== pageId) {
      return { code: 'STALE', version: this.version };
    }
    const entry = this.page?.entries.find((item) => item.workToken === workToken);
    if (entry !== undefined) {
      this.settlements.push({ requestId: entry.requestId, settlement });
      const entries = this.page?.entries.filter((item) => item.workToken !== workToken) ?? [];
      this.page = this.page === undefined ? undefined : { ...this.page, entries };
    }
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async settleRetry(
    fence: ClaimStateFence,
    requestId: string,
    workToken: string,
    settlement: string,
  ): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('settleRetry');
    if (fence.companyId !== COMPANY) return { code: 'STALE', version: this.version };
    const reservation = this.reservations.find((item) => item.requestId === requestId);
    if (reservation !== undefined && reservation.workToken !== workToken) {
      return { code: 'STALE', version: this.version };
    }
    this.settlements.push({ requestId, settlement });
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async finish(): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('finish');
    this.phase = 'IDLE';
    this.page = undefined;
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async read(): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('read');
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }
}

interface HarnessOptions {
  readonly rows?: Record<string, DueRatingRequest>;
  readonly upper?: string | null;
  readonly page?: readonly string[];
  readonly reservations?: readonly { requestId: string; workToken: string }[];
  readonly retries?: Record<string, ClaimStateRetry>;
  readonly acquireCode?: ClaimStateCode;
  readonly settlePageCode?: ClaimStateCode;
  readonly claimThrows?: string;
  readonly pageIdsThrows?: boolean;
}

interface Harness {
  readonly state: FakeState;
  readonly ports: RatingClaimsPorts<unknown>;
  readonly claimed: string[];
  readonly failures: string[];
  readonly fenceLosses: string[];
}

/** بينتج عالم الاختبار: حالة في الذاكرة ومنافذ وهمية بتتصرف زي الحقيقية. */
function harness(options: HarnessOptions = {}): Harness {
  const state = new FakeState();
  state.acquireCode = options.acquireCode ?? 'OK';
  state.settlePageCode = options.settlePageCode ?? 'OK';
  state.reservations = options.reservations ?? [];
  state.retries = options.retries ?? {};
  const rows = new Map<string, DueRatingRequest>(Object.entries(options.rows ?? {}));
  const page = options.page ?? [];
  const claimed: string[] = [];
  const failures: string[] = [];
  const fenceLosses: string[] = [];
  const diagnostics: RatingClaimDiagnostics = {
    failed: () => {
      failures.push('failed');
    },
    overflow: () => undefined,
    fenceLost: (_companyId, code) => {
      fenceLosses.push(code);
    },
    turnSummary: () => undefined,
  };
  const transactions: RatingClaimTransactions<unknown> = {
    upperId: async () => options.upper ?? null,
    pageIds: async (_companyId, _after, _through, limit) => {
      if (options.pageIdsThrows === true) throw new Error('SYNTHETIC_PAGE_READ_FAILURE');
      return page.slice(0, limit);
    },
    withRequest: async (_companyId, requestId, work) => work({}, rows.get(requestId) ?? null),
  };
  const claim = {
    execute: async (_tx: unknown, input: ClaimRatingRequestInput) => {
      if (options.claimThrows === input.request.id) throw new Error('SYNTHETIC_CLAIM_FAILURE');
      claimed.push(input.request.id);
      const row = rows.get(input.request.id);
      if (row !== undefined) rows.set(input.request.id, { ...row, status: 'SENDING' });
      return 'CLAIMED' as const;
    },
  };
  const requests = {
    findRequest: async (_tx: unknown, _companyId: string, requestId: string) =>
      rows.get(requestId) ?? null,
  };
  const ports: RatingClaimsPorts<unknown> = {
    state,
    transactions,
    requests,
    claim,
    diagnostics,
  };
  return { state, ports, claimed, failures, fenceLosses };
}

describe('دور خدمة المطالبة', () => {
  it('runs the retry lane before the forward lane and releases at the end', async () => {
    const world = harness({
      rows: { r1: request('r1', 'SCHEDULED', PAST), r2: request('r2', 'SCHEDULED', PAST) },
      reservations: [{ requestId: 'r1', workToken: 'w1' }],
      upper: 'r9',
      page: ['r2'],
    });
    const summary = await new ClaimRatingRequests(world.ports, ids, clock).execute(COMPANY);
    expect(world.state.calls).toEqual([
      'acquire',
      'reserveRetries',
      'settleRetry',
      'begin',
      'enrollPage',
      'settlePage',
      'finish',
      'release',
    ]);
    expect(summary.retryVisits).toBe(1);
    expect(summary.forwardVisits).toBe(1);
    expect(summary.end).toBe('COMPLETED');
  });

  it('never serves more rows than the budget allows', async () => {
    const world = harness({
      rows: {
        r1: request('r1', 'SCHEDULED', PAST),
        r2: request('r2', 'SCHEDULED', PAST),
        r3: request('r3', 'SCHEDULED', PAST),
      },
      reservations: [
        { requestId: 'r1', workToken: 'w1' },
        { requestId: 'r2', workToken: 'w2' },
      ],
      upper: 'r9',
      page: ['r3', 'r4'],
    });
    const summary = await new ClaimRatingRequests(world.ports, ids, clock, {
      forward: 1,
      retry: 1,
    }).execute(COMPANY);
    expect(summary.retryVisits).toBe(1);
    expect(summary.forwardVisits).toBe(1);
  });
});

describe('تسوية الصفوف', () => {
  it('settles a request that is already in the retry map as DELEGATED', async () => {
    const world = harness({
      rows: { r2: request('r2', 'SCHEDULED', PAST) },
      retries: { r2: { eligibleAt: 0, ticket: 1 } },
      upper: 'r9',
      page: ['r2'],
    });
    const summary = await new ClaimRatingRequests(world.ports, ids, clock).execute(COMPANY);
    expect(world.state.settlements).toEqual([{ requestId: 'r2', settlement: 'DELEGATED' }]);
    expect(world.claimed).toEqual([]);
    expect(summary.settlements.DELEGATED).toBe(1);
  });

  it('settles a future request as FUTURE_UNATTEMPTED without claiming it', async () => {
    const world = harness({
      rows: { r2: request('r2', 'SCHEDULED', FUTURE) },
      upper: 'r9',
      page: ['r2'],
    });
    const summary = await new ClaimRatingRequests(world.ports, ids, clock).execute(COMPANY);
    expect(world.state.settlements).toEqual([
      { requestId: 'r2', settlement: 'FUTURE_UNATTEMPTED' },
    ]);
    expect(world.claimed).toEqual([]);
    expect(summary.settlements.FUTURE_UNATTEMPTED).toBe(1);
  });

  it('settles a failed row as RETRY and keeps the page going', async () => {
    const world = harness({
      rows: { r2: request('r2', 'SCHEDULED', PAST), r3: request('r3', 'SCHEDULED', PAST) },
      upper: 'r9',
      page: ['r2', 'r3'],
      claimThrows: 'r2',
    });
    const summary = await new ClaimRatingRequests(world.ports, ids, clock).execute(COMPANY);
    expect(world.state.settlements).toEqual([
      { requestId: 'r2', settlement: 'RETRY' },
      { requestId: 'r3', settlement: 'TERMINAL' },
    ]);
    expect(world.failures).toHaveLength(1);
    expect(summary.forwardVisits).toBe(2);
  });
});

describe('ملكية الحالة', () => {
  it('ends the turn on a stale reply without reading a new page', async () => {
    const world = harness({
      rows: { r2: request('r2', 'SCHEDULED', PAST) },
      upper: 'r9',
      page: ['r2'],
      settlePageCode: 'STALE',
    });
    const summary = await new ClaimRatingRequests(world.ports, ids, clock).execute(COMPANY);
    expect(summary.end).toBe('FENCE_LOST');
    expect(world.state.calls.filter((call) => call === 'enrollPage')).toHaveLength(1);
    expect(world.state.calls).not.toContain('finish');
    expect(world.fenceLosses).toEqual(['STALE']);
  });

  it('touches nothing when another owner holds the state', async () => {
    const world = harness({ acquireCode: 'BUSY' });
    const summary = await new ClaimRatingRequests(world.ports, ids, clock).execute(COMPANY);
    expect(world.state.calls).toEqual(['acquire']);
    expect(summary.end).toBe('ACQUIRE_BUSY');
    expect(summary.forwardVisits).toBe(0);
    expect(summary.retryVisits).toBe(0);
  });

  it('closes an empty sweep for a company with no requests', async () => {
    const world = harness({ upper: null, page: [] });
    const summary = await new ClaimRatingRequests(world.ports, ids, clock).execute(COMPANY);
    expect(world.state.calls).toEqual(['acquire', 'reserveRetries', 'begin', 'finish', 'release']);
    expect(summary.end).toBe('COMPLETED');
    expect(summary.forwardVisits).toBe(0);
  });

  it('releases the state when the page read fails', async () => {
    const world = harness({ upper: 'r9', pageIdsThrows: true });
    const turn = new ClaimRatingRequests(world.ports, ids, clock);
    await expect(turn.execute(COMPANY)).rejects.toThrow('SYNTHETIC_PAGE_READ_FAILURE');
    expect(world.state.calls.filter((call) => call === 'release')).toHaveLength(1);
  });
});
