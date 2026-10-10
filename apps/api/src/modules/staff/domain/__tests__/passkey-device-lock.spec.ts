import { describe, expect, it } from 'vitest';
import { decidePasskeyDeviceLock } from '../passkey-device-lock.ts';

describe.each(['CHALLENGE', 'CLOCK', 'ENROL'] as const)('%s phone lock', (step) => {
  it.each(['NONE', 'THIS', 'OTHER'] as const)('another holder wins over own %s', (own) => {
    expect(
      decidePasskeyDeviceLock({
        step,
        own,
        bindingUnlocked: true,
        heldByOther: { holderEmployeeId: 'holder' },
      }),
    ).toEqual({
      kind: 'REFUSE',
      reason: step === 'ENROL' ? 'DEVICE_TAKEN' : 'DEVICE_LOCKED',
      holderEmployeeId: 'holder',
    });
  });
  it('refuses the person’s other phone without a holder', () => {
    expect(
      decidePasskeyDeviceLock({ step, own: 'OTHER', bindingUnlocked: true, heldByOther: null }),
    ).toEqual({
      kind: 'REFUSE',
      reason: step === 'ENROL' ? 'OTHER_DEVICE' : 'NOT_ENROLLED',
      holderEmployeeId: null,
    });
  });
  it.each(['NONE', 'THIS'] as const)(
    'accepts own %s and attaches only an unlocked write',
    (own) => {
      for (const bindingUnlocked of [true, false]) {
        expect(decidePasskeyDeviceLock({ step, own, bindingUnlocked, heldByOther: null })).toEqual({
          kind: 'ACCEPT',
          attach: step !== 'CHALLENGE' && bindingUnlocked,
        });
      }
    },
  );
});
