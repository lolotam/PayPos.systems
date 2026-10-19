import { expect, it, vi } from 'vitest';
import type {
  CashierPinTransactions,
  PinAttempts,
  PinHasher,
} from '../../ports/cashier-pins.port.ts';
import { VerifyCashierPin } from './verify-cashier-pin.ts';

const command = { companyId: 'company', employeeId: 'employee', pin: '1234' };

it('releases the reservation when the success transaction fails, so the attempt slot is not held', async () => {
  let runs = 0;
  const transactions = {
    run: vi.fn(async (_company: string, _device: unknown, work: (scope: unknown) => unknown) => {
      runs += 1;
      if (runs === 1) return work({ findHash: async () => 'stored-hash' });
      throw new Error('database unavailable');
    }),
  } as unknown as CashierPinTransactions;
  const hasher = { verify: vi.fn(async () => true) } as unknown as PinHasher;
  const attempts = {
    reserve: vi.fn(async () => ({ kind: 'ok' as const, reservation: 'held' })),
    succeeded: vi.fn(),
    failed: vi.fn(),
    release: vi.fn(async () => undefined),
  } as unknown as PinAttempts;
  await expect(
    new VerifyCashierPin(transactions, hasher, attempts).execute(command),
  ).rejects.toThrow('database unavailable');
  expect(attempts.release).toHaveBeenCalledWith(
    { companyId: 'company', employeeId: 'employee' },
    'held',
  );
  expect(attempts.failed).not.toHaveBeenCalled();
});
