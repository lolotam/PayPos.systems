import { describe, expect, it } from 'vitest';

import type { Clock, IdGenerator } from '../../../ports/clock.port.ts';
import type { RatingClaimDiagnostics } from '../../../ports/rating-claim-diagnostics.port.ts';
import type {
  ClaimStateCode,
  ClaimStateResult,
  ClaimStateSnapshot,
} from '../../../ports/rating-claim-state.port.ts';
import type { DueRatingRequest } from '../../../ports/rating-claim.repository.ts';
import { ClaimRatingRequests, type RatingClaimsPorts } from '../claim-rating-requests.ts';
import { COMPANY, FakeState } from './claim-rating-requests.fixture.ts';

const NOW = new Date('2026-11-01T08:00:00.000Z');
const clock: Clock = { now: () => NOW };
let counter = 0;
const ids: IdGenerator = {
  newId: () => `01920000-0000-7000-8000-${String(counter++).padStart(12, '0')}`,
};

/** حالة تقدر ترد برمز معيّن وقت الإفلات، أو تفشل خالص. */
class ReleasingState extends FakeState {
  releaseCode: ClaimStateCode = 'OK';
  releaseThrows = false;

  override async release(): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    if (this.releaseThrows) throw new Error('SYNTHETIC_RELEASE_FAILURE');
    this.calls.push('release');
    this.version += 1;
    return { code: this.releaseCode, version: this.version };
  }
}

interface Options {
  readonly releaseCode?: ClaimStateCode;
  readonly releaseThrows?: boolean;
  readonly pageIdsThrows?: boolean;
  readonly settlePageCode?: ClaimStateCode;
}

/** العالم: حالة بمنافذ وهمية، وتشخيص بيجمع ما اتسجل. */
function harness(options: Options = {}) {
  const state = new ReleasingState();
  state.releaseCode = options.releaseCode ?? 'OK';
  state.releaseThrows = options.releaseThrows ?? false;
  state.settlePageCode = options.settlePageCode ?? 'OK';
  const losses: { code: string; operation: string }[] = [];
  const failures: unknown[] = [];
  const diagnostics: RatingClaimDiagnostics = {
    failed: (_companyId, error) => {
      failures.push(error);
    },
    overflow: () => undefined,
    fenceLost: (_companyId, code, operation) => {
      losses.push({ code, operation: operation ?? 'turn' });
    },
    turnSummary: () => undefined,
  };
  const rows = new Map<string, DueRatingRequest>();
  const ports: RatingClaimsPorts<unknown> = {
    state,
    transactions: {
      upperId: async () => 'r9',
      pageIds: async () => {
        if (options.pageIdsThrows === true) throw new Error('SYNTHETIC_PAGE_READ_FAILURE');
        return ['r2'];
      },
      withRequest: async (_companyId, requestId, work) => work({}, rows.get(requestId) ?? null),
    },
    requests: { findRequest: async () => null },
    claim: { execute: async () => 'CLAIMED' as const },
    diagnostics,
  };
  return { ports, state, losses, failures };
}

describe('تشخيص إفلات الحالة', () => {
  it.each<[string, ClaimStateCode]>([
    ['busy', 'BUSY'],
    ['stale', 'STALE'],
    ['missing', 'MISSING'],
    ['corrupt', 'CORRUPT'],
  ])('a %s reply is recorded as a release fence loss', async (_scenario, code) => {
    const world = harness({ releaseCode: code });
    const summary = await new ClaimRatingRequests(world.ports, ids, clock).execute(COMPANY);
    expect(world.losses).toEqual([{ code, operation: 'release' }]);
    // سبب انتهاء الدور ما بيتبدلش برد الإفلات: الإفلات تنظيف مش حالة دور.
    expect(summary.end).toBe('COMPLETED');
  });

  it.each<[string, ClaimStateCode, string]>([
    ['limit', 'LIMIT', 'LIMIT_REACHED'],
    ['stale', 'STALE', 'FENCE_LOST'],
    ['corrupt', 'CORRUPT', 'STATE_CORRUPT'],
  ])('an existing %s halt survives a refused release', async (_scenario, haltCode, end) => {
    const world = harness({ settlePageCode: haltCode, releaseCode: 'BUSY' });
    const summary = await new ClaimRatingRequests(world.ports, ids, clock).execute(COMPANY);
    expect(summary.end).toBe(end);
    // الإفلات المرفوض بيتسجل زيادة، وسبب انتهاء الدور بيفضل زي ما هو.
    expect(world.losses.at(-1)).toEqual({ code: 'BUSY', operation: 'release' });
  });

  it('a refused release never turns a completed turn into a fence loss', async () => {
    const world = harness({ releaseCode: 'STALE' });
    const summary = await new ClaimRatingRequests(world.ports, ids, clock).execute(COMPANY);
    expect(summary.end).toBe('COMPLETED');
    expect(summary.settlements.TERMINAL).toBe(0);
  });

  it('a refused release beside a primary turn error keeps the primary error', async () => {
    const world = harness({ pageIdsThrows: true, releaseCode: 'BUSY' });
    const turn = new ClaimRatingRequests(world.ports, ids, clock);
    await expect(turn.execute(COMPANY)).rejects.toThrow('SYNTHETIC_PAGE_READ_FAILURE');
    // تشخيص الإفلات بيتسجل، بس الخطأ الأساسي هو اللي بيطلع للمشغّل.
    expect(world.losses).toEqual([{ code: 'BUSY', operation: 'release' }]);
    expect(world.failures).toHaveLength(1);
  });

  it('a release that throws on its own is reported and rethrown', async () => {
    const world = harness({ releaseThrows: true });
    const turn = new ClaimRatingRequests(world.ports, ids, clock);
    await expect(turn.execute(COMPANY)).rejects.toThrow('SYNTHETIC_RELEASE_FAILURE');
    expect(world.failures).toHaveLength(1);
    expect(world.losses).toEqual([]);
  });
});
