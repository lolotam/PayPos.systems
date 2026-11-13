import type { StaffSessions } from '@pospay/auth';
import { STAFF_LOGIN_CONCURRENCY } from '@pospay/auth';
import { expect, it, vi } from 'vitest';

import type { PinAttempts } from '../../ports/cashier-pins.port.ts';
import type { StaffPinRecord, StaffPinTransactions } from '../../ports/staff-pins.port.ts';
import { VerifyDiscountApproverPin } from './verify-discount-approver-pin.ts';

const input = {
  phone: '+99900000001',
  pin: '1234',
  device: { companyId: 'synthetic-company', deviceId: 'synthetic-device', branchId: 'synthetic-branch' },
};

function fixture() {
  const row = { id: 'revision-1', hash: 'stored-hash' };
  const find = vi.fn(async (): Promise<StaffPinRecord | null> => row);
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
    claimLockAudit: vi.fn(async () => false),
    confirmLockAudit: vi.fn(async () => undefined),
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
  const outcome = await f.useCase.execute(input);
  expect(outcome).toEqual({
    kind: 'ok', userId: 'user-1', pinRevision: 'revision-1', confirmBinding: expect.any(Function),
  });
  expect(f.sessions.issue).not.toHaveBeenCalled();
  if (outcome.kind === 'ok') {
    f.sessions.candidate.mockResolvedValue('user-2');
    await expect(outcome.confirmBinding()).resolves.toBe(false);
  }
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

it('a bound user without a PIN reserves the per-phone counter and uses the dummy hash', async () => {
  const f = fixture();
  f.find.mockResolvedValue(null);
  await expect(f.useCase.execute(input)).resolves.toEqual({ kind: 'refused' });
  expect(f.attempts.reserve).toHaveBeenCalledWith({
    companyId: input.device.companyId,
    employeeId: `counter:${input.phone}`,
  });
  expect(f.hasher.verify).toHaveBeenCalledWith(input.pin, null);
});

it('two phones of a PIN-less holder reserve separate targets while a PIN holder uses the user target', async () => {
  const f = fixture();
  f.find.mockResolvedValue(null);
  const otherPhone = '+99900000002';
  await f.useCase.execute(input);
  await f.useCase.execute({ ...input, phone: otherPhone });
  expect(f.attempts.reserve).toHaveBeenNthCalledWith(1, {
    companyId: input.device.companyId,
    employeeId: `counter:${input.phone}`,
  });
  expect(f.attempts.reserve).toHaveBeenNthCalledWith(2, {
    companyId: input.device.companyId,
    employeeId: `counter:${otherPhone}`,
  });
  const withPin = fixture();
  await withPin.useCase.execute(input);
  expect(withPin.attempts.reserve).toHaveBeenCalledWith({
    companyId: input.device.companyId,
    employeeId: 'staff-user:user-1',
  });
});

it('a PIN read error releases the cap admission before any attempt reservation', async () => {
  const f = fixture();
  f.find.mockRejectedValue(new Error('synthetic PIN read failure'));
  await expect(f.useCase.execute(input)).rejects.toThrow('synthetic PIN read failure');
  expect(f.cap.release).toHaveBeenCalledWith(input.device, 'admission-1');
  expect(f.attempts.reserve).not.toHaveBeenCalled();
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

it('a lock observed by cap.success wins over the correct PIN and audits a granted claim', async () => {
  const f = fixture();
  f.cap.success.mockResolvedValue('locked');
  f.cap.claimLockAudit.mockResolvedValue(true);
  await expect(f.useCase.execute(input)).resolves.toEqual({ kind: 'locked' });
  expect(f.devices.valid).not.toHaveBeenCalled();
  expect(f.record).toHaveBeenCalledTimes(1);
  expect(f.cap.confirmLockAudit).toHaveBeenCalledWith(input.device);
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

it('lockedNew with a granted claim writes exactly one device lock audit and confirms it', async () => {
  const f = fixture();
  f.hasher.verify.mockResolvedValue(false);
  f.cap.failure.mockResolvedValue('lockedNew');
  f.cap.claimLockAudit.mockResolvedValue(true);
  await expect(f.useCase.execute(input)).resolves.toEqual({ kind: 'locked' });
  expect(f.record).toHaveBeenCalledExactlyOnceWith({
    entity: 'device',
    entityId: input.device.deviceId,
    action: 'device.pin_approval_locked',
  });
  expect(f.cap.confirmLockAudit).toHaveBeenCalledWith(input.device);
});

it('an audit failure stays unconfirmed and a later locked answer retries and confirms', async () => {
  const f = fixture();
  f.hasher.verify.mockResolvedValue(false);
  f.cap.failure.mockResolvedValue('lockedNew');
  f.cap.claimLockAudit.mockResolvedValue(true);
  f.record.mockRejectedValueOnce(new Error('synthetic audit failure'));
  await expect(f.useCase.execute(input)).rejects.toThrow('synthetic audit failure');
  expect(f.cap.confirmLockAudit).not.toHaveBeenCalled();
  f.cap.failure.mockResolvedValue('locked');
  await expect(f.useCase.execute(input)).resolves.toEqual({ kind: 'locked' });
  expect(f.record).toHaveBeenCalledTimes(2);
  expect(f.cap.confirmLockAudit).toHaveBeenCalledExactlyOnceWith(input.device);
});

it('a locked answer without the audit claim writes no audit', async () => {
  const f = fixture();
  f.cap.admit.mockResolvedValue({ kind: 'locked' });
  await expect(f.useCase.execute(input)).resolves.toEqual({ kind: 'locked' });
  expect(f.record).not.toHaveBeenCalled();
  expect(f.cap.confirmLockAudit).not.toHaveBeenCalled();
});

it('a lock observed by admit audits and confirms a granted claim', async () => {
  const f = fixture();
  f.cap.admit.mockResolvedValue({ kind: 'locked' });
  f.cap.claimLockAudit.mockResolvedValue(true);
  await expect(f.useCase.execute(input)).resolves.toEqual({ kind: 'locked' });
  expect(f.record).toHaveBeenCalledTimes(1);
  expect(f.cap.confirmLockAudit).toHaveBeenCalledWith(input.device);
});
