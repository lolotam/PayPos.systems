import type {
  ClaimStateFence,
  ClaimStateResult,
  ClaimStateSnapshot,
  RatingClaimState,
} from '../ports/rating-claim-state.port.ts';
import { token, type StateContext } from './redis-rating-claim-state.context.ts';
import { RATING_CLAIM_STATE_ACQUIRE } from './rating-claim-state-acquire.lua.ts';
import { RATING_CLAIM_STATE_LEASE } from './rating-claim-state-lease.lua.ts';
import { RATING_CLAIM_STATE_SETTLE } from './rating-claim-state-settle.lua.ts';
import { RATING_CLAIM_STATE_SWEEP } from './rating-claim-state-sweep.lua.ts';

const ACQUIRE = RATING_CLAIM_STATE_ACQUIRE;
const LEASE = RATING_CLAIM_STATE_LEASE;
const SETTLE = RATING_CLAIM_STATE_SETTLE;
const SWEEP = RATING_CLAIM_STATE_SWEEP;

/** أوامر الملكية: استلام الحالة، وتجديد الحجز، وتسليمه. */
export function ownershipCommands(
  context: StateContext,
): Pick<RatingClaimState, 'acquire' | 'renew' | 'release'> {
  return {
    acquire: (companyId, newIncarnation, ownerToken) => {
      token(newIncarnation, 'INCARNATION');
      token(ownerToken, 'OWNER');
      return context.call(ACQUIRE, companyId, {
        companyId,
        incarnation: newIncarnation,
        ownerToken,
        ...context.limits,
      });
    },
    renew: (fence) =>
      context.serial(() =>
        context.call(LEASE, fence.companyId, context.fenceOf(fence, { action: 'renew' })),
      ),
    release: (fence) =>
      context.serial(() =>
        context.call(LEASE, fence.companyId, context.fenceOf(fence, { action: 'release' })),
      ),
  };
}

/** أوامر الجولة الأمامية: بدايتها، وتسجيل صفحة فيها، وإقفالها. */
export function sweepCommands(
  context: StateContext,
): Pick<RatingClaimState, 'begin' | 'enrollPage' | 'finish'> {
  return {
    begin: (fence, sweepId, upperId) =>
      context.call(
        SWEEP,
        fence.companyId,
        context.fenceOf(fence, { action: 'begin', sweepId, upperId: upperId ?? undefined }),
      ),
    enrollPage: (fence, sweepId, fromId, pageId, entries, exhausted, maxEntries) =>
      context.call(
        SWEEP,
        fence.companyId,
        context.fenceOf(fence, {
          action: 'enrollPage',
          sweepId,
          fromId: fromId ?? undefined,
          pageId,
          entries: entries.map((entry) => ({
            requestId: entry.requestId,
            workToken: entry.workToken,
          })),
          exhausted,
          maxEntries,
        }),
      ),
    finish: (fence, sweepId) =>
      context.serial(() =>
        context.call(SWEEP, fence.companyId, context.fenceOf(fence, { action: 'finish', sweepId })),
      ),
  };
}

/** أوامر الإعادة والتسوية: الحجز، وتسوية بند صفحة، وتسوية طلب في الخريطة. */
export function retryCommands(
  context: StateContext,
): Pick<RatingClaimState, 'reserveRetries' | 'settlePage' | 'settleRetry' | 'read'> {
  const settle = (
    action: 'settlePage' | 'settleRetry',
    fence: ClaimStateFence,
    target: Record<string, unknown>,
    workToken: string,
    settlement: string,
    storedDueAt: Date | null | undefined,
  ): Promise<ClaimStateResult<ClaimStateSnapshot>> =>
    context.serial(() =>
      context.call(
        SETTLE,
        fence.companyId,
        context.fenceOf(fence, {
          action,
          ...target,
          workToken,
          settlement,
          storedDueAt:
            storedDueAt === undefined || storedDueAt === null ? undefined : storedDueAt.getTime(),
          capacity: context.capacity,
          backoffMs: context.backoffMs,
          reserveBytes: context.reserveBytes,
        }),
      ),
    );
  return {
    reserveRetries: (fence, limit, workTokens) =>
      context.serial(() => context.reserve(fence, limit, workTokens)),
    settlePage: (fence, pageId, workToken, settlement, storedDueAt) =>
      settle('settlePage', fence, { pageId }, workToken, settlement, storedDueAt),
    settleRetry: (fence, requestId, workToken, settlement, storedDueAt) =>
      settle('settleRetry', fence, { requestId }, workToken, settlement, storedDueAt),
    read: (companyId) =>
      context.call(LEASE, companyId, { companyId, action: 'read', ...context.limits }),
  };
}
