import { beforeEach, expect, it, vi } from 'vitest';
import type { SendStaffOtp } from '../use-cases/send-staff-otp/send-staff-otp.ts';
import { createReservedOtpWorker } from './reserved-otp-worker.ts';

const state = vi.hoisted(() => ({ listeners: new Map<string, (...args: unknown[]) => void>() }));
vi.mock('bullmq', () => ({
  Worker: class {
    on(name: string, listener: (...args: unknown[]) => void) {
      state.listeners.set(name, listener);
    }
  },
}));
beforeEach(() => state.listeners.clear());

it('worker and job failures notify the bounded callback without forwarding errors or job data', () => {
  const failure = vi.fn();
  createReservedOtpWorker(
    { execute: vi.fn() } as unknown as SendStaffOtp,
    'redis://127.0.0.1:6379',
    { onError: failure },
  );
  state.listeners.get('error')?.(new Error('SYNTHETIC_PRIVATE_DETAIL'));
  state.listeners.get('failed')?.(
    { data: 'SYNTHETIC_PRIVATE_DETAIL' },
    new Error('SYNTHETIC_PRIVATE_DETAIL'),
  );
  expect(failure.mock.calls).toEqual([[], []]);
});
