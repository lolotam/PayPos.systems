import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PushSubscriptionInput } from '@pospay/contracts';

import { pushCalls } from './push-calls';

const INSTALLATION = '12345678-1234-4234-8234-123456789abc';

const subscription: PushSubscriptionInput = {
  installation_id: INSTALLATION,
  vapid_key_id: '0123456789abcdef',
  delivery_token: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  subscription: {
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
    expirationTime: null,
    keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
  },
  locale: 'en',
};

const fetcher = vi.fn();

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetcher);
});

afterEach(() => vi.unstubAllGlobals());

it('keeps the raw installation id out of the registration URL and inside the body', async () => {
  fetcher.mockResolvedValue(new Response(null, { status: 204 }));

  await pushCalls.register(subscription);

  expect(fetcher).toHaveBeenCalledTimes(1);
  const request = fetcher.mock.calls[0]?.[0] as Request;
  expect(request.url).toContain('/v1/staff/push/subscription');
  expect(request.url).not.toContain(INSTALLATION);
  expect(await request.clone().text()).toContain(INSTALLATION);
});

it('keeps the raw installation id out of the revoke URL and inside the body', async () => {
  fetcher.mockResolvedValue(new Response(null, { status: 204 }));

  await pushCalls.revoke(INSTALLATION);

  expect(fetcher).toHaveBeenCalledTimes(1);
  const request = fetcher.mock.calls[0]?.[0] as Request;
  expect(request.url).toContain('/v1/staff/push/subscription/revoke');
  expect(request.url).not.toContain(INSTALLATION);
  expect(await request.clone().text()).toContain(INSTALLATION);
});

it('answers the ready configuration with the public key and the subscriber reference', async () => {
  const config = {
    vapid_public_key: 'public-key',
    vapid_key_id: '0123456789abcdef',
    subscriber_ref: 'r'.repeat(64),
  };
  fetcher.mockResolvedValue(json(config));

  await expect(pushCalls.config()).resolves.toEqual({ kind: 'ready', config });
});

it('answers a push that is not configured as not ready', async () => {
  fetcher.mockResolvedValue(json({ code: 'NOT_READY', message_ar: '', message_en: '' }, 503));

  await expect(pushCalls.config()).resolves.toEqual({ kind: 'not-ready' });
});

it('refuses a registration made under a key the server no longer serves', async () => {
  fetcher.mockResolvedValue(
    json({ code: 'PUSH_KEY_STALE', message_ar: '', message_en: '' }, 409),
  );

  await expect(pushCalls.register(subscription)).rejects.toThrow('PUSH_KEY_STALE');
});
