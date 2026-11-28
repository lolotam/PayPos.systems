import { expect, it, vi } from 'vitest';
import { SignInStaffPin } from './sign-in-staff-pin.ts';
import type {
  StaffPinAuthority,
  StaffPinProofIssuer,
  StaffPinTransactions,
} from '../../ports/staff-pins.port.ts';
import type { PinAttempts } from '../../ports/cashier-pins.port.ts';

const unlimitedGate = { acquire: () => () => undefined };

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
  const proofs = {
    issue: vi.fn(() => ({ proof: 'synthetic-proof', hash: 'synthetic-hash' })),
    digest: vi.fn(() => 'synthetic-hash'),
  } as unknown as StaffPinProofIssuer;
  const clock = { now: () => new Date('2026-11-25T10:00:00.000Z') };
  const ids = { newId: () => 'synthetic-id' };
  return {
    authority,
    db,
    hasher,
    attempts,
    proofs,
    signIn: new SignInStaffPin(
      db,
      hasher,
      attempts,
      authority,
      proofs,
      clock,
      ids,
      false,
      unlimitedGate,
    ),
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

function usableUser(over: { eligible?: boolean; deviceValid?: boolean }) {
  const f = fixture('synthetic-user');
  const row = {
    id: 'pin-revision',
    hash: 'stored',
    temporary: true,
    expiresAt: new Date('2026-11-26T10:00:00.000Z'),
  };
  const issueProof = vi.fn();
  vi.mocked(f.db.run).mockImplementation((async (
    _c: string,
    _a: string | null,
    work: (s: unknown) => unknown,
  ) => work({ find: async () => row, issueProof })) as never);
  f.hasher.verify.mockResolvedValue(true);
  vi.mocked(f.authority.deviceValid).mockResolvedValue(over.deviceValid ?? true);
  vi.mocked(f.authority.eligible).mockResolvedValue(over.eligible ?? true);
  const signIn = new SignInStaffPin(
    f.db,
    f.hasher,
    f.attempts,
    f.authority,
    f.proofs,
    { now: () => new Date('2026-11-25T10:00:00.000Z') },
    { newId: () => 'synthetic-id' },
    true,
    unlimitedGate,
  );
  return { ...f, signIn, issueProof };
}

it.each([
  ['an ineligible user', { eligible: false }],
  ['an invalid device', { deviceValid: false }],
] as const)('%s with a temporary PIN counts a failure and gets no proof', async (_name, over) => {
  const f = usableUser(over);
  expect(await f.signIn.execute({ phone, pin, device })).toBeNull();
  expect(f.attempts.failed).toHaveBeenCalledOnce();
  expect(f.attempts.succeeded).not.toHaveBeenCalled();
  expect(f.issueProof).not.toHaveBeenCalled();
  expect(f.authority.sessions.issue).not.toHaveBeenCalled();
});

it('issueSession checks findLocked and withholds the audit row if the PIN revision changed', async () => {
  const f = fixture('synthetic-user');
  let revision = 'pin-revision';
  const readRow = async () => ({ id: revision, hash: 'stored', temporary: false, expiresAt: null });
  const record = vi.fn();
  vi.mocked(f.db.run).mockImplementation((async (
    _c: string,
    _a: string | null,
    work: (s: unknown) => unknown,
  ) => work({ find: readRow, findLocked: readRow, audit: { record } })) as never);
  f.hasher.verify.mockResolvedValue(true);
  vi.mocked(f.attempts.succeeded).mockResolvedValue('ok');
  vi.mocked(f.authority.deviceValid).mockResolvedValue(true);
  vi.mocked(f.authority.eligible).mockResolvedValue(true);
  vi.mocked(f.authority.sessions.issue).mockImplementation(async (_u, _d, validate) => {
    revision = 'reset-revision';
    const valid = await validate();
    if (!valid) return null as never;
    return { session: {} as never, cookie: 'cookie' };
  });
  expect(await f.signIn.execute({ phone, pin, device })).toBeNull();
  expect(record).not.toHaveBeenCalled();
});
