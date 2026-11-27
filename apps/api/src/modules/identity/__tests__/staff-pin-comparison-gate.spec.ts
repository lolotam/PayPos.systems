import { STAFF_LOGIN_CONCURRENCY, type StaffSessions } from '@pospay/auth';
import { expect, it, vi } from 'vitest';

import { createStaffPinComparisonGate } from '../persistence/staff-pin-comparison-gate.ts';
import type { PinAttempts, PinHasher } from '../ports/cashier-pins.port.ts';
import type {
  StaffPinAuthority,
  StaffPinComparisonGate,
  StaffPinProofIssuer,
  StaffPinTransactions,
} from '../ports/staff-pins.port.ts';
import { OpenPrivateView } from '../use-cases/open-private-view/open-private-view.ts';
import { SignInStaffPin } from '../use-cases/sign-in-staff-pin/sign-in-staff-pin.ts';
import { VerifyDiscountApproverPin } from '../use-cases/verify-discount-approver-pin/verify-discount-approver-pin.ts';

const device = {
  companyId: 'synthetic-company',
  businessId: 'synthetic-business',
  branchId: 'synthetic-branch',
  deviceId: 'synthetic-device',
};
const phone = '+99900000001';
const pin = String(10).padStart(4, '0');

function sharedGatePeers(gate: StaffPinComparisonGate, barrier: Promise<void>) {
  const sessions = {
    ready: vi.fn(() => barrier),
    candidate: vi.fn(async () => null),
    pinCounterKey: vi.fn(() => 'counter-key'),
    issue: vi.fn(),
  } as unknown as StaffSessions;
  const authority = {
    sessions,
    deviceValid: vi.fn(async () => true),
    eligible: vi.fn(async () => true),
  } as unknown as StaffPinAuthority;
  const db = { run: vi.fn() } as StaffPinTransactions;
  const hasher: PinHasher = { hash: vi.fn(), verify: vi.fn(async () => false) };
  const attempts = {
    reserve: vi.fn(async () => ({ kind: 'ok' as const, reservation: 'synthetic' })),
    failed: vi.fn(),
    succeeded: vi.fn(),
    release: vi.fn(),
  } as unknown as PinAttempts;
  const proofs = { issue: vi.fn(), digest: vi.fn() } as unknown as StaffPinProofIssuer;

  return {
    signIn: new SignInStaffPin(
      db,
      hasher,
      attempts,
      authority,
      proofs,
      { now: () => new Date('2026-11-25T10:00:00.000Z') },
      { newId: () => 'synthetic-id' },
      true,
      gate,
    ),
    openPrivateView: new OpenPrivateView(
      db,
      attempts,
      authority,
      { provePin: vi.fn(async () => null), open: vi.fn(), close: vi.fn() } as never,
      gate,
    ),
    discountApprover: new VerifyDiscountApproverPin(
      db,
      hasher,
      attempts,
      sessions,
      {
        admit: vi.fn(() => barrier.then(() => ({ kind: 'locked' as const }))),
        failure: vi.fn(),
        success: vi.fn(),
        claimLockAudit: vi.fn(async () => false),
        confirmLockAudit: vi.fn(),
        release: vi.fn(),
      },
      { valid: vi.fn(async () => true) },
      gate,
    ),
  };
}

it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
  'createStaffPinComparisonGate refuses invalid limit %s',
  (limit) => {
    expect(() => createStaffPinComparisonGate(limit)).toThrow('STAFF_PIN_GATE_LIMIT_INVALID');
  },
);

it('createStaffPinComparisonGate caps concurrency and makes release idempotent (#786)', () => {
  const gate = createStaffPinComparisonGate(2);
  const first = gate.acquire();
  const second = gate.acquire();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(gate.acquire()).toBeNull();

  // تحرير مزدوج لا يرفع السعة المتاحة عن الحد الأصلي (idempotent release).
  first?.();
  first?.();
  const third = gate.acquire();
  expect(third).not.toBeNull();
  expect(gate.acquire()).toBeNull();

  second?.();
  third?.();
  const a = gate.acquire();
  const b = gate.acquire();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(gate.acquire()).toBeNull();
  a?.();
  b?.();
});

it('shares one concurrency limit across SignInStaffPin, OpenPrivateView and VerifyDiscountApproverPin (#786)', async () => {
  const gate = createStaffPinComparisonGate(STAFF_LOGIN_CONCURRENCY);
  let releaseBarrier: () => void = () => undefined;
  const barrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });
  const { signIn, openPrivateView, discountApprover } = sharedGatePeers(gate, barrier);
  const session = {
    userId: 'synthetic-user',
    sessionId: 'synthetic-session',
    context: device,
    authenticatedAt: new Date('2026-11-25T09:00:00.000Z'),
    deadline: new Date('2026-11-25T17:00:00.000Z'),
  };
  const running = [
    ...Array.from({ length: STAFF_LOGIN_CONCURRENCY - 1 }, () =>
      signIn.execute({ phone, pin, device }),
    ),
    discountApprover.execute({ phone, pin, device }),
  ];
  await expect(openPrivateView.execute({ pin, session })).rejects.toThrow('STAFF_PIN_UNAVAILABLE');
  await expect(signIn.execute({ phone, pin, device })).rejects.toThrow('STAFF_PIN_UNAVAILABLE');
  await expect(discountApprover.execute({ phone, pin, device })).resolves.toEqual({ kind: 'busy' });
  releaseBarrier();
  await Promise.all(running);
  await expect(signIn.execute({ phone, pin, device })).resolves.toBeNull();
});
