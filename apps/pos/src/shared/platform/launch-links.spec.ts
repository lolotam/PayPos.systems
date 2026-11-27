import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readLaunchLink } from './launch-links';

const launch = vi.hoisted(() => ({ getLaunchUrl: vi.fn() }));

vi.mock('@capacitor/app', () => ({
  App: { getLaunchUrl: launch.getLaunchUrl },
}));

const URL = 'https://pos.staging.pospay.systems/personal?company=a&business=b';

describe('readLaunchLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('answers the launch URL once and stays quiet for the same one afterwards', async () => {
    launch.getLaunchUrl.mockResolvedValue({ url: URL });

    await expect(readLaunchLink()).resolves.toBe(URL);
    await expect(readLaunchLink()).resolves.toBeNull();
  });

  it('answers a new launch URL when the app is opened with another one', async () => {
    launch.getLaunchUrl.mockResolvedValueOnce({ url: URL });
    launch.getLaunchUrl.mockResolvedValueOnce({ url: `${URL}-other` });

    await expect(readLaunchLink()).resolves.toBe(URL);
    await expect(readLaunchLink()).resolves.toBe(`${URL}-other`);
  });

  it('answers nothing when the app was opened without a link', async () => {
    launch.getLaunchUrl.mockResolvedValue({ url: '' });

    await expect(readLaunchLink()).resolves.toBeNull();
  });

  it('answers nothing when the platform refuses to give the launch URL', async () => {
    launch.getLaunchUrl.mockRejectedValue(new Error('SYNTHETIC_LAUNCH_FAILURE'));

    await expect(readLaunchLink()).resolves.toBeNull();
  });
});
