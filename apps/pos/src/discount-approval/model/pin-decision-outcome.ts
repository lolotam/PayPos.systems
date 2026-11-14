import type { CallResult, Failure } from '@/shared/api/call';

export type PinDecisionOutcome =
  | { kind: 'done' }
  | { kind: 'pinInvalid' | 'locked' | 'busy' }
  | { kind: 'stale' | 'failure'; failure: Failure };

export function pinDecisionOutcome(result: CallResult<unknown>): PinDecisionOutcome {
  if (result.ok) return { kind: 'done' };
  const failure = result.failure;
  if (failure.kind !== 'http' || failure.envelope === null) return { kind: 'failure', failure };
  switch (failure.envelope.code) {
    case 'PIN_INVALID':
      return { kind: 'pinInvalid' };
    case 'PIN_LOCKED':
      return { kind: 'locked' };
    case 'TOO_MANY_REQUESTS':
      return { kind: 'busy' };
    case 'DISCOUNT_PROPOSAL_NOT_PENDING':
    case 'DISCOUNT_PROPOSAL_CHANGED':
      return { kind: 'stale', failure };
    default:
      return { kind: 'failure', failure };
  }
}
