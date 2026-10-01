import { useEffect } from 'react';

import { watchClaim } from './claim-loop';

export function useClaimPoll(
  active: boolean,
  onApproved: () => void,
  onRefused: () => void,
): void {
  useEffect(() => {
    if (!active) return undefined;
    return watchClaim(onApproved, onRefused);
  }, [active, onApproved, onRefused]);
}
