import { expect, it, vi } from 'vitest';

import { ChangeTemporaryStaffPin } from './change-temporary-staff-pin.ts';
import type { PinAttempts, PinHasher } from '../../ports/cashier-pins.port.ts';
import type {
  StaffPinProofIssuer,
  StaffPinScope,
  StaffPinTransactions,
} from '../../ports/staff-pins.port.ts';

const device = {
  companyId: 'synthetic-company',
  businessId: 'synthetic-business',
  branchId: 'synthetic-branch',
  deviceId: 'synthetic-device',
};
const now = new Date('2026-11-25T10:00:00.000Z');
const pin = '5678';

interface Overrides {
  readonly find?: StaffPinScope['find'];
  readonly findProof?: StaffPinScope['findProof'];
  readonly consumeProof?: StaffPinScope['consumeProof'];
  readonly rotatePin?: StaffPinScope['rotatePin'];
  readonly reserve?: PinAttempts['reserve'];
  readonly verify?: PinHasher['verify'];
  readonly member?: boolean;
  readonly deviceValid?: boolean;
  readonly eligible?: boolean;
}

function authorityOf(overrides: Overrides) {
  return {
    deviceValid: vi.fn(async () => overrides.deviceValid ?? true),
    eligible: vi.fn(async () => overrides.eligible ?? true),
  };
}

function fixture(overrides: Overrides = {}) {
  const scope = {
    audit: { record: vi.fn() },
    member: vi.fn(async () => overrides.member ?? true),
    find: vi.fn(
      overrides.find ??
        (async () => ({
          id: 'pin-revision',
          hash: 'stored-hash',
          temporary: true,
          expiresAt: new Date('2026-11-26T10:00:00.000Z'),
        })),
    ),
    save: vi.fn(),
    issueProof: vi.fn(),
    findProof: vi.fn(
      overrides.findProof ??
        (async () => ({
          userId: 'synthetic-user',
          pinRevision: 'pin-revision',
          expiresAt: new Date('2026-11-25T10:10:00.000Z'),
          consumedAt: null,
        })),
    ),
    consumeProof: vi.fn(overrides.consumeProof ?? (async () => true)),
    rotatePin: vi.fn(overrides.rotatePin ?? (async () => true)),
  } as unknown as StaffPinScope;
  const db = {
    run: vi.fn(async (_companyId: string, _actor: string | null, work: (s: StaffPinScope) => unknown) =>
      work(scope),
    ),
  } as unknown as StaffPinTransactions;
  const hasher = {
    hash: vi.fn(async () => 'new-hash'),
    verify: vi.fn(overrides.verify ?? (async () => false)),
  } as unknown as PinHasher;
  const attempts = {
    reserve: vi.fn(
      overrides.reserve ?? (async () => ({ kind: 'ok' as const, reservation: 'synthetic' })),
    ),
    failed: vi.fn(),
    succeeded: vi.fn(async () => 'ok' as const),
    release: vi.fn(),
  } as unknown as PinAttempts;
  const proofs = {
    issue: vi.fn(() => ({ proof: 'raw-proof', hash: 'raw-proof-hash' })),
    digest: vi.fn(() => 'raw-proof-hash'),
  } as unknown as StaffPinProofIssuer;
  const authority = authorityOf(overrides);
  return {
    scope,
    authority,
    db,
    hasher,
    attempts,
    proofs,
    useCase: new ChangeTemporaryStaffPin(db, hasher, attempts, proofs, { now: () => now }, authority),
  };
}

it('a valid proof rotates the temporary PIN into a permanent one and audits the change', async () => {
  const f = fixture();
  expect(await f.useCase.execute({ proof: 'raw-proof', pin, device })).toEqual({ kind: 'changed' });
  expect(f.scope.consumeProof).toHaveBeenCalledWith({
    userId: 'synthetic-user',
    deviceId: 'synthetic-device',
    pinRevision: 'pin-revision',
    proofHash: 'raw-proof-hash',
    at: now,
  });
  expect(f.scope.rotatePin).toHaveBeenCalledWith({
    userId: 'synthetic-user',
    pinRevision: 'pin-revision',
    hash: 'new-hash',
    at: now,
  });
  expect(f.scope.audit.record).toHaveBeenCalledWith({
    entity: 'cashier_pin',
    entityId: 'synthetic-user',
    action: 'staff.pin_changed',
  });
  expect(f.attempts.succeeded).toHaveBeenCalledOnce();
  expect(f.attempts.failed).not.toHaveBeenCalled();
});

it('the temporary PIN in use cannot be chosen again', async () => {
  const f = fixture({ verify: async () => true });
  expect(await f.useCase.execute({ proof: 'raw-proof', pin, device })).toEqual({ kind: 'invalid' });
  expect(f.scope.rotatePin).not.toHaveBeenCalled();
  expect(f.scope.audit.record).not.toHaveBeenCalled();
  expect(f.attempts.failed).toHaveBeenCalledOnce();
});

it('a proof that was already consumed is refused without touching the PIN', async () => {
  const f = fixture({
    findProof: async () => ({
      userId: 'synthetic-user',
      pinRevision: 'pin-revision',
      expiresAt: new Date('2026-11-25T10:10:00.000Z'),
      consumedAt: new Date('2026-11-25T10:01:00.000Z'),
    }),
  });
  expect(await f.useCase.execute({ proof: 'raw-proof', pin, device })).toEqual({ kind: 'invalid' });
  expect(f.scope.consumeProof).not.toHaveBeenCalled();
  expect(f.scope.rotatePin).not.toHaveBeenCalled();
});

it('an expired proof is refused and counted as a failure', async () => {
  const f = fixture({
    findProof: async () => ({
      userId: 'synthetic-user',
      pinRevision: 'pin-revision',
      expiresAt: new Date('2026-11-25T09:59:59.000Z'),
      consumedAt: null,
    }),
  });
  expect(await f.useCase.execute({ proof: 'raw-proof', pin, device })).toEqual({ kind: 'invalid' });
  expect(f.scope.consumeProof).not.toHaveBeenCalled();
  expect(f.attempts.failed).toHaveBeenCalledOnce();
});

it('an unknown proof is refused and counted against the device, never against a user', async () => {
  const f = fixture({ findProof: async () => null });
  expect(await f.useCase.execute({ proof: 'raw-proof', pin, device })).toEqual({ kind: 'invalid' });
  expect(f.attempts.reserve).toHaveBeenCalledWith({
    companyId: 'synthetic-company',
    employeeId: 'staff-device:synthetic-device',
  });
  expect(f.attempts.failed).toHaveBeenCalledOnce();
});

it('a known proof is counted against the user who owns the PIN', async () => {
  const f = fixture();
  await f.useCase.execute({ proof: 'raw-proof', pin, device });
  expect(f.attempts.reserve).toHaveBeenCalledWith({
    companyId: 'synthetic-company',
    employeeId: 'staff-user:synthetic-user',
  });
});

it('a locked counter refuses the change before anything is read again', async () => {
  const f = fixture({ reserve: async () => ({ kind: 'locked' as const }) });
  expect(await f.useCase.execute({ proof: 'raw-proof', pin, device })).toEqual({ kind: 'locked' });
  expect(f.scope.rotatePin).not.toHaveBeenCalled();
});

it('an expired temporary PIN reports the expiry instead of changing anything', async () => {
  const f = fixture({
    find: async () => ({
      id: 'pin-revision',
      hash: 'stored-hash',
      temporary: true,
      expiresAt: new Date('2026-11-25T09:59:59.000Z'),
    }),
  });
  expect(await f.useCase.execute({ proof: 'raw-proof', pin, device })).toEqual({ kind: 'expired' });
  expect(f.scope.consumeProof).not.toHaveBeenCalled();
  expect(f.scope.rotatePin).not.toHaveBeenCalled();
});

it('a permanent PIN has nothing to change', async () => {
  const f = fixture({
    find: async () => ({
      id: 'pin-revision',
      hash: 'stored-hash',
      temporary: false,
      expiresAt: null,
    }),
  });
  expect(await f.useCase.execute({ proof: 'raw-proof', pin, device })).toEqual({ kind: 'invalid' });
  expect(f.scope.rotatePin).not.toHaveBeenCalled();
});

it('a PIN the manager reset after the proof was issued is refused', async () => {
  const f = fixture({ rotatePin: async () => false });
  expect(await f.useCase.execute({ proof: 'raw-proof', pin, device })).toEqual({ kind: 'invalid' });
  expect(f.scope.audit.record).not.toHaveBeenCalled();
});

it.each([
  ['an invalid device', { deviceValid: false }],
  ['an ineligible user', { eligible: false }],
  ['a lapsed membership', { member: false }],
] as const)('%s is refused without rotating the PIN', async (_name, overrides) => {
  const f = fixture(overrides);
  expect(await f.useCase.execute({ proof: 'raw-proof', pin, device })).toEqual({ kind: 'invalid' });
  expect(f.scope.rotatePin).not.toHaveBeenCalled();
  expect(f.scope.audit.record).not.toHaveBeenCalled();
  expect(f.attempts.failed).toHaveBeenCalledOnce();
});