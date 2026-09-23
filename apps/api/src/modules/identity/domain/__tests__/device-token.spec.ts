import { describe, expect, it } from 'vitest';

import { deviceTokenExpiry, isDeviceTokenLive } from '../device-token.ts';

const T0 = new Date('2026-09-23T10:00:00.000Z');

describe('device token lifetime (PRD D-09)', () => {
  it('is 30 days from the contact', () => {
    expect(deviceTokenExpiry(T0).toISOString()).toBe('2026-10-23T10:00:00.000Z');
  });

  it('is live until the last instant before expiry, not at it', () => {
    const expiry = deviceTokenExpiry(T0);
    expect(isDeviceTokenLive(expiry, new Date(expiry.getTime() - 1))).toBe(true);
    expect(isDeviceTokenLive(expiry, expiry)).toBe(false);
  });

  it('each contact starts the 30 days again', () => {
    const later = new Date('2026-10-20T10:00:00.000Z');
    expect(deviceTokenExpiry(later).getTime()).toBeGreaterThan(deviceTokenExpiry(T0).getTime());
  });
});
