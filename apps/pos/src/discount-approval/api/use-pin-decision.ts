import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { StaffPinInput } from '@pospay/contracts';

import { pinDecisionOutcome, type PinDecisionOutcome } from '../model/pin-decision-outcome';
import {
  decideDeviceDiscountProposal,
  type DeviceDecisionInput,
  type DeviceProposal,
} from './device-discount-calls';

export type PinDecision = 'approve' | 'reject';
type DecisionState = { outcome: PinDecisionOutcome; decision: PinDecision };

export function usePinDecision(branchId: string) {
  const client = useQueryClient();
  const mounted = useRef(true);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [current, setCurrent] = useState<DecisionState | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const decide = async (
    proposal: DeviceProposal,
    decision: PinDecision,
    { phone, pin }: StaffPinInput,
    reason = '',
  ) => {
    if (!navigator.onLine || busy.current) return;
    busy.current = true;
    setPending(true);
    setCurrent(null);
    const body: DeviceDecisionInput = {
      proposal_ids: [proposal.id],
      terms_hashes: [proposal.terms_hash],
      phone,
      pin,
    };
    if (decision === 'reject' && reason.trim() !== '') body.reason = reason.trim();
    const outcome = pinDecisionOutcome(await decideDeviceDiscountProposal(decision, body));
    if (mounted.current) setCurrent({ outcome, decision });
    if (outcome.kind === 'done' || outcome.kind === 'stale') {
      void client.invalidateQueries({ queryKey: ['device-discount-proposals', branchId] });
    }
    busy.current = false;
    if (mounted.current) setPending(false);
  };
  return {
    pending,
    outcome: current?.outcome ?? null,
    decision: current?.decision ?? null,
    decide,
    clear: () => setCurrent(null),
  };
}
