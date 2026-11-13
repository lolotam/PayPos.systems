import type { StaffSessions } from '@pospay/auth';
import { STAFF_LOGIN_CONCURRENCY } from '@pospay/auth';
import { expect, it, vi } from 'vitest';

import type { PinAttempts } from '../../ports/cashier-pins.port.ts';
import type { StaffPinTransactions } from '../../ports/staff-pins.port.ts';
import { VerifyDiscountApproverPin } from './verify-discount-approver-pin.ts';

const input = {
  phone: '+99900000001',
  pin: '1234',
  device: { companyId: 'synthetic-company', deviceId: 'synthetic-device', branchId: 'synthetic-branch' },
};

function fixture() {
  const row = { id: 'revision-1', hash: 'stored-hash' };
  const find = vi.fn(async () => row);
  const record = vi.fn(async () => undefined);
  const db = {
    run: vi.fn(async (_company: string, _actor: null, work: (scope: unknown) => unknown) =>
      work({ find, audit: { record } }),
    ),
  } as unknown as StaffPinTransactions;
  const hasher = { hash: vi.fn(), verify: vi.fn(async () => true) };
  const attempts = {
    reserve: vi.fn(async () => ({ kind: 'ok' as const, reservation: 'reservation-1' })),
    failed: vi.fn(async () => 'failed' as const),
    succeeded: vi.fn(async () => 'ok' as const),
    release: vi.fn(async () => undefined),
  } as unknown as PinAttempts;
  const sessions = {
    ready: vi.fn(async () => undefined),
    candidate: vi.fn(async (): Promise<string | null> => 'user-1'),
    pinCounterKey: vi.fn((phone: string) => `counter:${phone}`),
    issue: vi.fn(),
  };
  const cap = {
    admit: vi.fn(async (): Promise<{ kind: 'ok'; admission: string } | { kind: 'locked' }> =>
      ({ kind: 'ok', admission: 'admission-1' })),
    failure: vi.fn(async (): Promise<'failed' | 'locked' | 'lockedNew' | 'expired'> => 'failed'),
    success: vi.fn(async (): Promise<'ok' | 'locked' | 'expired'> => 'ok'),
    release: vi.fn(async () => undefined),
  };
  const devices = { valid: vi.fn(async () => true) };
  const useCase = new VerifyDiscountApproverPin(
    db,
    hasher,
    attempts,
    sessions as unknown as StaffSessions,
    cap,
    devices,
  );
  return { useCase, hasher, attempts, sessions, cap, devices, find, record };
}

it('ok returns the user and PIN revision without issuing a session', async () => {
  const f = fixture();
  await expect(f.useCase.execute(input)).resolves.toEqual({
    kind: 'ok', userId: 'user-1', pinRevision: 'revision-1',
  });
  expect(f.sessions.issue).not.toHaveBeenCalled();
});

it('an unknown phone reserves its pinCounterKey target and is refused', async () => {
  const f = fixture();
  f.sessions.candidate.mockResolvedValue(null);
  await expect(f.useCase.execute(input)).resolves.toEqual({ kind: 'refused' });
  expect(f.sessions.pinCounterKey).toHaveBeenCalledWith(input.phone);
  expect(f.attempts.reserve).toHaveBeenCalledWith({
    companyId: input.device.companyId,
    employeeId: `counter:${input.phone}`,
  });
  expect(f.hasher.verify).toHaveBeenCalledWith(input.pin, null);
});

it('a wrong PIN records attempts.failed and cap.failure', async () => {
  const f = fixture();
  f.hasher.verify.mockResolvedValue(false);
  await expect(f.useCase.execute(input)).resolves.toEqual({ kind: 'refused' });
  expect(f.attempts.failed).toHaveBeenCalledWith(
    { companyId: input.device.companyId, employeeId: 'staff-user:user-1' },
    'reservation-1',
  );
  expect(f.cap.failure).toHaveBeenCalledWith(input.device, 'admission-1');
});

it('a device lock does not reserve attempts but still performs the dummy hash', async () => {
  const f = fixture();
  f.cap.admit.mockResolvedValue({ kind: 'locked' });
  await expect(f.useCase.execute(input)).resolves.toEqual({ kind: 'locked' });
  expect(f.attempts.reserve).not.toHaveBeenCalled();
  expect(f.hasher.verify).toHaveBeenCalledExactlyOnceWith(input.pin, null);
});

it.each(['locked', 'busy'] as const)('per-user %s releases the cap admission', async (kind) => {
  const f = fixture();
  vi.mocked(f.attempts.reserve).mockResolvedValue({ kind });
  await expect(f.useCase.execute(input)).resolves.toEqual({ kind });
  expect(f.cap.release).toHaveBeenCalledWith(input.device, 'admission-1');
  expect(f.hasher.verify).toHaveBeenCalledExactlyOnceWith(input.pin, null);
});

it('a hasher error releases both reservations and rethrows', async () => {
  const f = fixture();
  f.hasher.verify.mockRejectedValue(new Error('synthetic hasher failure'));
  await expect(f.useCase.execute(input)).rejects.toThrow('synthetic hasher failure');
  expect(f.attempts.release).toHaveBeenCalledWith(
    { companyId: input.device.companyId, employeeId: 'staff-user:user-1' },
    'reservation-1',
  );
  expect(f.cap.release).toHaveBeenCalledWith(input.device, 'admission-1');
  expect(f.attempts.failed).not.toHaveBeenCalled();
});

it('a lock observed by cap.success wins over the correct PIN', async () => {
  const f = fixture();
  f.cap.success.mockResolvedValue('locked');
  await expect(f.useCase.execute(input)).resolves.toEqual({ kind: 'locked' });
  expect(f.devices.valid).not.toHaveBeenCalled();
});

it.each(['candidate', 'revision', 'device'] as const)('recheck refuses when the %s changes', async (change) => {
  const f = fixture();
  if (change === 'candidate') {
    f.sessions.candidate.mockResolvedValueOnce('user-1').mockResolvedValueOnce('user-2');
  } else if (change === 'revision') {
    f.find.mockResolvedValueOnce({ id: 'revision-1', hash: 'stored-hash' })
      .mockResolvedValueOnce({ id: 'revision-2', hash: 'new-hash' });
  } else {
    f.devices.valid.mockResolvedValue(false);
  }
  await expect(f.useCase.execute(input)).resolves.toEqual({ kind: 'refused' });
  expect(f.sessions.issue).not.toHaveBeenCalled();
});

it('the process concurrency cap answers busy without another admission', async () => {
  const f = fixture();
  let release: () => void = () => undefined;
  const gate = new Promise<{ kind: 'ok'; admission: string }>((resolve) => {
    release = () => resolve({ kind: 'ok', admission: 'admission-1' });
  });
  f.cap.admit.mockImplementation(() => gate);
  const pending = Array.from({ length: STAFF_LOGIN_CONCURRENCY }, () => f.useCase.execute(input));
  await expect(f.useCase.execute(input)).resolves.toEqual({ kind: 'busy' });
  expect(f.cap.admit).toHaveBeenCalledTimes(STAFF_LOGIN_CONCURRENCY);
  release();
  await Promise.all(pending);
});

it('lockedNew writes exactly one device lock audit', async () => {
  const f = fixture();
  f.hasher.verify.mockResolvedValue(false);
  f.cap.failure.mockResolvedValue('lockedNew');
  await expect(f.useCase.execute(input)).resolves.toEqual({ kind: 'locked' });
  expect(f.record).toHaveBeenCalledExactlyOnceWith({
    entity: 'device',
    entityId: input.device.deviceId,
    action: 'device.pin_approval_locked',
  });
});
