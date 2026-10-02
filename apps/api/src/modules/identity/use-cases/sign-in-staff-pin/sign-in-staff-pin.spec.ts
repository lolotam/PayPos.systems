import { expect, it, vi } from 'vitest';
import { SignInStaffPin } from './sign-in-staff-pin.ts';
import type { StaffPinAuthority, StaffPinTransactions } from '../../ports/staff-pins.port.ts';
import type { PinAttempts } from '../../ports/cashier-pins.port.ts';

const device = {
  companyId: 'synthetic-company',
  businessId: 'synthetic-business',
  branchId: 'synthetic-branch',
  deviceId: 'synthetic-device',
};
const phone = '+99900000001',
  other = '+99900000002',
  pin = String(10).padStart(4, '0');
function fixture(userId: string | null = null) {
  const authority = {
    sessions: {
      ready: vi.fn(),
      candidate: vi.fn(async () => userId),
      pinCounterKey: vi.fn(
        (value: string) => `staff-phone:${(value === phone ? '11' : '22').repeat(32)}`,
      ),
      issue: vi.fn(),
    },
    deviceValid: vi.fn(),
    eligible: vi.fn(),
  } as unknown as StaffPinAuthority;
  const db = { run: vi.fn() } as StaffPinTransactions;
  const hasher = { hash: vi.fn(), verify: vi.fn(async () => false) };
  const attempts = {
    reserve: vi.fn(async () => ({ kind: 'ok' as const, reservation: 'synthetic' })),
    failed: vi.fn(),
    succeeded: vi.fn(),
    release: vi.fn(),
  } as unknown as PinAttempts;
  return {
    authority,
    db,
    hasher,
    attempts,
    signIn: new SignInStaffPin(db, hasher, attempts, authority),
  };
}

it('unknown phones reserve separate keyed counters and each performs the dummy comparison', async () => {
  const f = fixture();
  await f.signIn.execute({ phone, pin, device });
  await f.signIn.execute({ phone: other, pin, device });
  expect(vi.mocked(f.attempts.reserve).mock.calls.map(([target]) => target.employeeId)).toEqual([
    `staff-phone:${'11'.repeat(32)}`,
    `staff-phone:${'22'.repeat(32)}`,
  ]);
  expect(f.hasher.verify.mock.calls).toEqual([
    [pin, null],
    [pin, null],
  ]);
  expect(f.db.run).not.toHaveBeenCalled();
});

it.each(['locked', 'busy'] as const)(
  '%s approved and unknown phones perform identical dummy work',
  async (kind) => {
    for (const userId of [null, 'synthetic-user']) {
      const f = fixture(userId);
      vi.mocked(f.attempts.reserve).mockResolvedValue({ kind });
      expect(await f.signIn.execute({ phone, pin, device })).toBeNull();
      expect(f.hasher.verify).toHaveBeenCalledExactlyOnceWith(pin, null);
      expect(f.db.run).not.toHaveBeenCalled();
      expect(f.authority.sessions.issue).not.toHaveBeenCalled();
    }
  },
);
