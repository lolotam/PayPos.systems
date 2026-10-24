import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { usePersonalSignIn } from './use-personal-sign-in';

const CHALLENGE = '00000000-0000-4000-8000-000000000003';
const WORKSPACE = {
  company_id: '00000000-0000-4000-8000-000000000001',
  business_id: '00000000-0000-4000-8000-000000000002',
};

const fakes = vi.hoisted(() => ({
  order: [] as string[],
  suspended: false,
  calls: { request: vi.fn(), verify: vi.fn() },
}));

vi.mock('@pospay/contracts', () => ({
  personalOtpRequestInput: { parse: (value: unknown) => value },
  personalOtpVerifyInput: { parse: (value: unknown) => value },
}));
vi.mock('./personal-calls', () => ({
  personalCalls: { request: fakes.calls.request, verify: fakes.calls.verify },
}));
vi.mock('../push/push-calls', () => ({
  withTimeout: <T,>(promise: Promise<T>) => promise,
}));
vi.mock('../push/push-sign-in-check', () => ({
  suspendPushForSignIn: vi.fn(async () => {
    fakes.order.push('suspend');
    fakes.suspended = true;
  }),
  runSignInPushCheck: vi.fn(async () => {
    fakes.order.push('check');
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fakes.order = [];
  fakes.suspended = false;
  fakes.calls.request.mockResolvedValue({ challenge_id: CHALLENGE });
  fakes.calls.verify.mockResolvedValue({ challenge_id: CHALLENGE });
});

it('suspends the push record before it announces the new session', async () => {
  const { result } = renderHook(() =>
    usePersonalSignIn(WORKSPACE, () => {
      fakes.order.push('changed');
    }),
  );

  await act(async () => {
    await result.current.request({ phone: '+96550000000', locale: 'en' });
  });
  await act(async () => {
    await result.current.verify('123456');
  });

  await waitFor(() => expect(fakes.order).toContain('changed'));
  expect(fakes.suspended).toBe(true);
  expect(fakes.order.indexOf('suspend')).toBeLessThan(fakes.order.indexOf('changed'));
});
