import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { pushFixture, type PushFixture } from './push-subscription.fixture.ts';
import { validAuth, validP256dh } from './push-test-keys.ts';

let f: PushFixture;
let counter = 0;
const nextId = () => `01920000-0000-4000-8000-${String(counter++).padStart(12, '0')}`;
// نقطة خارج المنحنى: بادئة صحّية بس إحداثياتها مش على المنحنى، فالتشفير بيفشل بيه.
const offCurve = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 7)]).toString('base64url');
// مفتاح مصادقة 15 بايت بدل 16.
const shortAuth = randomBytes(15).toString('base64url');

const body = (keys: { p256dh: string; auth: string }) => ({
  installation_id: nextId(),
  vapid_key_id: f.config.keyId,
  delivery_token: nextId(),
  subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${nextId()}`, keys },
  locale: 'ar',
});

const ownCount = async () =>
  Number(
    (
      await f.owner`SELECT count(*)::int AS count FROM push_subscriptions
        WHERE company_id=${f.companyId} AND user_id=${f.userId}`
    )[0]?.['count'],
  );

beforeAll(async () => {
  f = await pushFixture();
});
afterAll(async () => {
  await f?.close();
});

it('refuses a p256dh that is not a point on the curve, and stores nothing', async () => {
  const before = await ownCount();
  const result = await f.send('PUT', '/v1/staff/push/subscription', {
    body: body({ p256dh: offCurve, auth: validAuth() }),
  });
  expect(result.status).toBe(400);
  expect(result.body['code']).toBe('VALIDATION_FAILED');
  expect(await ownCount()).toBe(before);
});

it('refuses an auth secret that is not sixteen bytes, and stores nothing', async () => {
  const before = await ownCount();
  const result = await f.send('PUT', '/v1/staff/push/subscription', {
    body: body({ p256dh: validP256dh(), auth: shortAuth }),
  });
  expect(result.status).toBe(400);
  expect(result.body['code']).toBe('VALIDATION_FAILED');
  expect(await ownCount()).toBe(before);
});
