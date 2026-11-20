import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { StaffPinInput } from '@pospay/contracts';

import { pinDecisionOutcome, type PinDecisionOutcome } from '../model/pin-decision-outcome';
import {
  decideDeviceDiscountProposal,
  type DeviceDecisionInput,
  type DeviceProposal,
} from './device-discount-calls';

export type PinDecision = 'approve' | 'reject';
type DecisionState = { outcome: PinDecisionOutcome; decision: PinDecision };
type HeldDecision = { body: DeviceDecisionInput; decision: PinDecision; generation: string };

function useDecisionRuntime(operatorKey: string) {
  const mounted = useRef(true);
  const busy = useRef(false);
  const generation = useRef(operatorKey);
  const held = useRef<HeldDecision | null>(null);
  const [pending, setPending] = useState(false);
  const [current, setCurrent] = useState<DecisionState | null>(null);
  const [stateOperator, setStateOperator] = useState(operatorKey);
  // مسح أثر قرار المشغّل السابق لازم يحصل أثناء الرندر نفسه، مش في effect متأخر —
  // أول commit للمشغّل الجديد لازم يعرض تنبيهات قراره هو بس.
  if (stateOperator !== operatorKey) {
    setStateOperator(operatorKey);
    setCurrent(null);
  }
  useLayoutEffect(() => {
    generation.current = operatorKey;
    held.current = null;
  }, [operatorKey]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      held.current = null;
    };
  }, []);
  return { mounted, busy, generation, held, pending, setPending, current, setCurrent };
}

type DecisionRuntime = ReturnType<typeof useDecisionRuntime>;

async function sendDecision(
  runtime: DecisionRuntime,
  client: QueryClient,
  branchId: string,
  input: HeldDecision,
) {
  const retry = input.body.approver_membership_id !== undefined;
  runtime.busy.current = true;
  runtime.setPending(true);
  runtime.setCurrent(null);
  let outcome = pinDecisionOutcome(await decideDeviceDiscountProposal(input.decision, input.body));
  if (retry && outcome.kind === 'pickMembership') {
    outcome = { kind: 'failure', failure: outcome.failure };
  }
  // نتيجة طلب قديم لا تحتفظ ببياناته ولا تظهر للمشغّل الجديد بعد تبديله.
  if (runtime.mounted.current && runtime.generation.current === input.generation) {
    if (!retry && outcome.kind === 'pickMembership') runtime.held.current = input;
    runtime.setCurrent({ outcome, decision: input.decision });
  }
  if (outcome.kind === 'done' || outcome.kind === 'stale') {
    void client.invalidateQueries({ queryKey: ['device-discount-proposals', branchId] });
  }
  runtime.busy.current = false;
  if (runtime.mounted.current) runtime.setPending(false);
}

export function usePinDecision(branchId: string, operatorKey: string) {
  const client = useQueryClient();
  const runtime = useDecisionRuntime(operatorKey);
  const decide = async (
    proposal: DeviceProposal,
    decision: PinDecision,
    { phone, pin }: StaffPinInput,
    reason = '',
  ) => {
    if (!navigator.onLine || runtime.busy.current) return;
    runtime.held.current = null;
    const body: DeviceDecisionInput = {
      proposal_ids: [proposal.id],
      terms_hashes: [proposal.terms_hash],
      phone,
      pin,
    };
    if (decision === 'reject' && reason.trim() !== '') body.reason = reason.trim();
    const input = { body, decision, generation: operatorKey };
    await sendDecision(runtime, client, branchId, input);
  };
  const chooseMembership = async (membershipId: string) => {
    if (
      !navigator.onLine ||
      runtime.busy.current ||
      runtime.current?.outcome.kind !== 'pickMembership'
    ) {
      return;
    }
    const input = runtime.held.current;
    if (input === null) return;
    runtime.held.current = null;
    const body = { ...input.body, approver_membership_id: membershipId };
    await sendDecision(runtime, client, branchId, { ...input, body });
  };
  const clear = () => {
    runtime.held.current = null;
    runtime.setCurrent(null);
  };
  return {
    pending: runtime.pending,
    outcome: runtime.current?.outcome ?? null,
    decision: runtime.current?.decision ?? null,
    decide,
    chooseMembership,
    clear,
  };
}
