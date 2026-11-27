import { beforeEach, describe, expect, it, vi } from 'vitest';

import { markLaunchLinkHandled, readLaunchLink } from './launch-links';

const launch = vi.hoisted(() => ({ getLaunchUrl: vi.fn() }));

vi.mock('@capacitor/app', () => ({
  App: { getLaunchUrl: launch.getLaunchUrl },
}));

const LAUNCH_URL = 'https://pos.staging.pospay.systems/personal?company=a&business=b#fragment';

describe('readLaunchLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('does not consume the launch link before the caller marks it handled', async () => {
    launch.getLaunchUrl.mockResolvedValue({ url: LAUNCH_URL });

    await expect(readLaunchLink()).resolves.toBe(LAUNCH_URL);
    await expect(readLaunchLink()).resolves.toBe(LAUNCH_URL);

    markLaunchLinkHandled(LAUNCH_URL);

    await expect(readLaunchLink()).resolves.toBeNull();
  });

  it('stores only a fingerprint in sessionStorage and never the raw URL or parameters', async () => {
    launch.getLaunchUrl.mockResolvedValue({ url: LAUNCH_URL });

    await expect(readLaunchLink()).resolves.toBe(LAUNCH_URL);
    markLaunchLinkHandled(LAUNCH_URL);

    const stored = window.sessionStorage.getItem('pospay.native.launchUrl');
    expect(stored).not.toBeNull();
    expect(stored).not.toContain('pos.staging.pospay.systems');
    expect(stored).not.toContain('company=');
    expect(stored).not.toContain('business=');
    expect(stored).not.toContain('#fragment');
  });

  it('answers a new launch URL when the app is opened with another one', async () => {
    launch.getLaunchUrl.mockResolvedValueOnce({ url: LAUNCH_URL });
    launch.getLaunchUrl.mockResolvedValueOnce({ url: `${LAUNCH_URL}-other` });

    await expect(readLaunchLink()).resolves.toBe(LAUNCH_URL);
    markLaunchLinkHandled(LAUNCH_URL);
    await expect(readLaunchLink()).resolves.toBe(`${LAUNCH_URL}-other`);
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
