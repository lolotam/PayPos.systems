import { beforeEach, describe, expect, it, vi } from 'vitest';

import { personalCalls } from '@/personal-staff/api/personal-calls';
import { announcePersonalChange } from '@/personal-staff/model/session-change';

import { endPersonalSession } from './end-sessions';

vi.mock('@/personal-staff/api/personal-calls', () => ({
  personalCalls: { signOut: vi.fn() },
}));
vi.mock('@/personal-staff/model/session-change', () => ({
  announcePersonalChange: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('endPersonalSession', () => {
  it('counts the answer of the server as done and tells every screen to drop its cache', async () => {
    vi.mocked(personalCalls.signOut).mockResolvedValue(undefined);

    await expect(endPersonalSession()).resolves.toBe('done');
    expect(personalCalls.signOut).toHaveBeenCalledTimes(1);
    expect(announcePersonalChange).toHaveBeenCalledTimes(1);
  });

  it.each(['PERSONAL_SIGN_OUT_REFUSED', 'PERSONAL_SIGN_OUT_UNCLEAR'])(
    'fails without announcing when the server answers %s',
    async (code) => {
      vi.mocked(personalCalls.signOut).mockRejectedValue(new Error(code));

      await expect(endPersonalSession()).resolves.toBe('failed');
      expect(announcePersonalChange).not.toHaveBeenCalled();
    },
  );

  it('fails without announcing when the network is down', async () => {
    vi.mocked(personalCalls.signOut).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(endPersonalSession()).resolves.toBe('failed');
    expect(announcePersonalChange).not.toHaveBeenCalled();
  });
});
