import { describe, expect, it } from 'vitest';

import {
  isAllowedPushEndpoint,
  isAllowedPushHost,
  pushConfig,
  pushEndpoint,
  pushRevokeInput,
  pushSubscriptionInput,
  PUSH_ENDPOINT_HOST_RULES,
} from '../push-subscription.js';

const INSTALLATION = '01920000-0000-4000-8000-0000000000a1';
const P256DH = 'A'.repeat(87);
const AUTH = 'B'.repeat(22);
const KEY_ID = '0123456789abcdef';

const body = (overrides: Record<string, unknown> = {}) => ({
  installation_id: INSTALLATION,
  vapid_key_id: KEY_ID,
  delivery_token: '01920000-0000-4000-8000-0000000000a2',
  subscription: {
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-endpoint',
    keys: { p256dh: P256DH, auth: AUTH },
  },
  locale: 'ar',
  ...overrides,
});

describe('the allowed push hosts', () => {
  it('accepts the three fixed hosts and any windows notification host with a label before it', () => {
    for (const host of [
      'fcm.googleapis.com',
      'updates.push.services.mozilla.com',
      'web.push.apple.com',
      'db5.notify.windows.com',
      'a.notify.windows.com',
    ])
      expect(isAllowedPushHost(host), host).toBe(true);
    expect(PUSH_ENDPOINT_HOST_RULES.hosts).toHaveLength(3);
    expect(PUSH_ENDPOINT_HOST_RULES.suffix).toBe('.notify.windows.com');
  });

  it('refuses a look-alike host and a windows suffix without a label before it', () => {
    for (const host of [
      'fcm.googleapis.com.evil.test',
      'evilfcm.googleapis.com',
      'fcm.googleapis.com.evil.test.notify.windows.com',
      '.notify.windows.com',
      'notify.windows.com',
      'fcm.googleapis.co',
    ])
      expect(isAllowedPushHost(host), host).toBe(false);
  });
});

describe('pushEndpoint', () => {
  it('accepts an https endpoint on an allowed host', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://db5.notify.windows.com/w/?token=abc',
      'https://fcm.googleapis.com:443/fcm/send/abc',
    ])
      expect(pushEndpoint.safeParse(endpoint).success, endpoint).toBe(true);
  });

  it('refuses a non-https scheme, a user-info, a port and an IP literal', () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'ftp://fcm.googleapis.com/abc',
      'https://fcm.googleapis.com@evil.test/abc',
      'https://user:pass@fcm.googleapis.com/abc',
      'https://fcm.googleapis.com:8443/abc',
      'https://127.0.0.1/abc',
      'https://[::1]/abc',
      'not a url',
      '',
    ])
      expect(pushEndpoint.safeParse(endpoint).success, endpoint).toBe(false);
  });

  it('refuses a look-alike host, an uppercase host and a trailing-dot host', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com.evil.test/abc',
      'https://evilfcm.googleapis.com/abc',
      'https://FCM.GOOGLEAPIS.COM/abc',
      'https://fcm.googleapis.com./abc',
      'https://fcm-googleapis.com/abc',
      'https://xn--fcm-hia.googleapis.com/abc',
      'https://fcm\u0433oogleapis.com/abc',
    ])
      expect(pushEndpoint.safeParse(endpoint).success, endpoint).toBe(false);
  });

  it('refuses an endpoint longer than 2048 characters', () => {
    const long = `https://fcm.googleapis.com/${'a'.repeat(2048)}`;
    expect(long.length).toBeGreaterThan(2048);
    expect(pushEndpoint.safeParse(long).success).toBe(false);
  });
});

describe('pushSubscriptionInput', () => {
  it('accepts a complete subscription and refuses an unknown key', () => {
    expect(pushSubscriptionInput.safeParse(body()).success).toBe(true);
    expect(pushSubscriptionInput.safeParse({ ...body(), extra: true }).success).toBe(false);
    expect(
      pushSubscriptionInput.safeParse(
        body({
          subscription: {
            endpoint: 'https://fcm.googleapis.com/x',
            keys: { p256dh: P256DH, auth: AUTH, x: 1 },
          },
        }),
      ).success,
    ).toBe(false);
  });

  it('refuses a bad installation id, key id, token, locale or key length', () => {
    expect(pushSubscriptionInput.safeParse(body({ installation_id: 'not-a-uuid' })).success).toBe(
      false,
    );
    expect(
      pushSubscriptionInput.safeParse(body({ vapid_key_id: 'ABCDEF0123456789' })).success,
    ).toBe(false);
    expect(pushSubscriptionInput.safeParse(body({ delivery_token: 'not-a-uuid' })).success).toBe(
      false,
    );
    expect(pushSubscriptionInput.safeParse(body({ locale: 'fr' })).success).toBe(false);
    expect(
      pushSubscriptionInput.safeParse(
        body({
          subscription: {
            endpoint: 'https://fcm.googleapis.com/x',
            keys: { p256dh: 'A'.repeat(86), auth: AUTH },
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      pushSubscriptionInput.safeParse(
        body({
          subscription: {
            endpoint: 'https://fcm.googleapis.com/x',
            keys: { p256dh: P256DH, auth: 'B'.repeat(21) },
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      pushSubscriptionInput.safeParse(
        body({
          subscription: {
            endpoint: 'https://fcm.googleapis.com/x',
            keys: { p256dh: `${'A'.repeat(86)}=`, auth: AUTH },
          },
        }),
      ).success,
    ).toBe(false);
  });
});

describe('pushRevokeInput and pushConfig', () => {
  it('revoke takes only an installation id', () => {
    expect(pushRevokeInput.safeParse({ installation_id: INSTALLATION }).success).toBe(true);
    expect(pushRevokeInput.safeParse({ installation_id: INSTALLATION, extra: 1 }).success).toBe(
      false,
    );
    expect(pushRevokeInput.safeParse({}).success).toBe(false);
  });

  it('the config carries the public key, its id and the subscriber reference', () => {
    expect(
      pushConfig.safeParse({
        vapid_public_key: 'BPublic',
        vapid_key_id: KEY_ID,
        subscriber_ref: 'c'.repeat(64),
      }).success,
    ).toBe(true);
    expect(
      pushConfig.safeParse({
        vapid_public_key: '',
        vapid_key_id: KEY_ID,
        subscriber_ref: 'c'.repeat(64),
      }).success,
    ).toBe(false);
    expect(
      pushConfig.safeParse({
        vapid_public_key: 'BPublic',
        vapid_key_id: KEY_ID,
        subscriber_ref: 'C'.repeat(64),
      }).success,
    ).toBe(false);
  });
});
