import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createStaffOtpMaintenance } from './execution.ts';

const database = vi.hoisted(() => ({ ping: vi.fn(), cleanup: vi.fn(), close: vi.fn() }));
vi.mock('@pospay/db', () => ({ createStaffOtpDatabase: () => database }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it('hourly auth-only cleanup needs no OTP activation, transport configuration or derivation keys', async () => {
  const failures = vi.fn();
  const maintenance = createStaffOtpMaintenance({
    databaseUrl: 'synthetic',
    phoneLockKey: () => 0n,
    onFailure: failures,
  });
  expect(database.ping).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3_599_999);
  expect(database.cleanup).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(database.ping).toHaveBeenCalledOnce();
  expect(database.cleanup).toHaveBeenCalledWith(100);
  expect(failures).not.toHaveBeenCalled();
  await maintenance.close();
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(database.cleanup).toHaveBeenCalledOnce();
  expect(database.close).toHaveBeenCalledOnce();
});
it('wrong-role/schema failure is a finite internal diagnostic, with no cleanup fallback', async () => {
  const failures = vi.fn();
  database.ping.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_ERROR'));
  const maintenance = createStaffOtpMaintenance({
    databaseUrl: 'synthetic',
    phoneLockKey: () => 0n,
    onFailure: failures,
  });
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(failures).toHaveBeenCalledWith();
  expect(database.cleanup).not.toHaveBeenCalled();
  await maintenance.close();
});

it('shutdown cancels the database before draining unfinished maintenance and prevents late cleanup', async () => {
  let complete: (() => void) | undefined;
  database.ping.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const maintenance = createStaffOtpMaintenance({
    databaseUrl: 'synthetic',
    phoneLockKey: () => 0n,
    onFailure: vi.fn(),
  });
  const running = maintenance.run();
  const closing = maintenance.close();
  expect(database.close).toHaveBeenCalledOnce();
  complete?.();
  await Promise.all([running, closing]);
  expect(database.cleanup).not.toHaveBeenCalled();
});
