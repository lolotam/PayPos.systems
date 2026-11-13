import type { VerifyDiscountApproverPin } from '../../identity/index.ts';
import { DiscountPinError } from '../domain/discount-pin-error.ts';
import type { DiscountPinApproverPort } from '../ports/discount-decision.port.ts';

/** The identity facility this adapter drives; it is null when the PIN service is not wired. */
export type DiscountPinVerifier = VerifyDiscountApproverPin;

export function discountPinApprover(verifier: DiscountPinVerifier | null): DiscountPinApproverPort {
  return {
    verify: async (verification) => {
      if (verifier === null) throw new DiscountPinError('NOT_READY');
      const outcome = await verifier.execute({
        phone: verification.phone,
        pin: verification.pin,
        device: {
          companyId: verification.companyId,
          deviceId: verification.deviceId,
          branchId: verification.branchId,
        },
      });
      if (outcome.kind !== 'ok') return outcome;
      return { kind: 'ok', userId: outcome.userId, pinRevision: outcome.pinRevision };
    },
  };
}
