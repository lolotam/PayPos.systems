import { beforeEach, describe, expect, it, vi } from 'vitest';

import { personalCalls } from '@/personal-staff/api/personal-calls';
import { announcePersonalChange } from '@/personal-staff/model/session-change';
import { disablePushOnSignOut } from '@/personal-staff/push/push-disable';

import { endPersonalSession } from './end-sessions';

vi.mock('@/personal-staff/api/personal-calls', () => ({
  personalCalls: { signOut: vi.fn() },
}));
vi.mock('@/personal-staff/model/session-change', () => ({
  announcePersonalChange: vi.fn(),
}));
vi.mock('@/personal-staff/push/push-disable', () => ({
  disablePushOnSignOut: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(disablePushOnSignOut).mockResolvedValue(undefined);
});

describe('endPersonalSession', () => {
  it('counts the answer of the server as done and tells every screen to drop its cache', async () => {
    vi.mocked(personalCalls.signOut).mockResolvedValue(undefined);

    await expect(endPersonalSession()).resolves.toBe('done');
    expect(disablePushOnSignOut).toHaveBeenCalledTimes(1);
    expect(personalCalls.signOut).toHaveBeenCalledTimes(1);
    expect(vi.mocked(disablePushOnSignOut).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(personalCalls.signOut).mock.invocationCallOrder[0] ?? 0,
    );
    expect(announcePersonalChange).toHaveBeenCalledTimes(1);
  });

  it.each(['PERSONAL_SIGN_OUT_REFUSED', 'PERSONAL_SIGN_OUT_UNCLEAR', 'TypeError'])(
    'fails without announcing when the sign-out ends with %s',
    async (code) => {
      vi.mocked(personalCalls.signOut).mockRejectedValue(
        code === 'TypeError' ? new TypeError('Failed to fetch') : new Error(code),
      );

      await expect(endPersonalSession()).resolves.toBe('failed');
      expect(announcePersonalChange).not.toHaveBeenCalled();
    },
  );
});
