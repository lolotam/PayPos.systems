import { installationHash } from '@pospay/notifications';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { pushFixture, type PushFixture } from './push-subscription.fixture.ts';

let f: PushFixture;
let counter = 0;
const nextId = () => `01920000-0000-4000-8000-${String(counter++).padStart(12, '0')}`;
const subscription = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
});
const body = (over: Record<string, unknown> = {}) => ({
  installation_id: nextId(),
  vapid_key_id: f.config.keyId,
  delivery_token: nextId(),
  subscription: subscription(`https://fcm.googleapis.com/fcm/send/${nextId()}`),
  locale: 'ar',
  ...over,
});
const liveFor = async (endpoint: string) =>
  await f.owner`SELECT count(*)::int AS count FROM push_subscriptions
    WHERE company_id=${f.companyId} AND endpoint=${endpoint} AND revoked_at IS NULL`;
const generationOf = async (userId: string, installation: string) => {
  const hash = installationHash(f.companyId, installation);
  const [row] = await f.owner`SELECT generation FROM push_subscriptions
    WHERE company_id=${f.companyId} AND user_id=${userId}
      AND encode(installation_hash,'hex')=${hash}`;
  return Number(row?.['generation']);
};
// الصف السليم: حيّ بكل أسراره، أو مسحوب بلا سر واحد.
const validState = (row: Record<string, unknown>): boolean => {
  const secrets = ['endpoint', 'p256dh', 'auth', 'delivery_token'];
  const present = secrets.filter((key) => row[key] !== null).length;
  return row['revoked_at'] === null ? present === secrets.length : present === 0;
};

beforeAll(async () => {
  f = await pushFixture();
});
afterAll(async () => {
  await f?.close();
});

describe('two employees on one endpoint', () => {
  it('one registers while the other does: no 5xx and one live row', async () => {
    const colleague = await f.seedStaff('Synthetic colleague');
    const endpoint = `https://fcm.googleapis.com/fcm/send/${nextId()}`;
    const results = await Promise.all([
      f.send('PUT', '/v1/staff/push/subscription', {
        body: body({ subscription: subscription(endpoint) }),
      }),
      f.send('PUT', '/v1/staff/push/subscription', {
        body: body({ subscription: subscription(endpoint) }),
        headers: colleague.headers,
      }),
    ]);
    for (const result of results) {
      expect([204, 409], String(result.status)).toContain(result.status);
      if (result.status === 409) expect(result.body['code']).toBe('PUSH_REGISTRATION_BUSY');
    }
    expect((await liveFor(endpoint))[0]?.['count']).toBe(1);
  });

  it('one employee registering the same endpoint twice keeps one live row', async () => {
    const colleague = await f.seedStaff('Synthetic twice');
    const endpoint = `https://fcm.googleapis.com/fcm/send/${nextId()}`;
    const results = await Promise.all([
      f.send('PUT', '/v1/staff/push/subscription', {
        body: body({ subscription: subscription(endpoint) }),
        headers: colleague.headers,
      }),
      f.send('PUT', '/v1/staff/push/subscription', {
        body: body({ subscription: subscription(endpoint) }),
        headers: colleague.headers,
      }),
    ]);
    expect(results.map((result) => result.status)).toEqual([204, 204]);
    expect((await liveFor(endpoint))[0]?.['count']).toBe(1);
  });

  it('crossing registrations move both endpoints without a 5xx', async () => {
    const colleague = await f.seedStaff('Synthetic colleague');
    const mine = `https://fcm.googleapis.com/fcm/send/${nextId()}`;
    const theirs = `https://fcm.googleapis.com/fcm/send/${nextId()}`;
    await f.send('PUT', '/v1/staff/push/subscription', {
      body: body({ subscription: subscription(mine) }),
    });
    await f.send('PUT', '/v1/staff/push/subscription', {
      body: body({ subscription: subscription(theirs) }),
      headers: colleague.headers,
    });
    const results = await Promise.all([
      f.send('PUT', '/v1/staff/push/subscription', {
        body: body({ subscription: subscription(theirs) }),
      }),
      f.send('PUT', '/v1/staff/push/subscription', {
        body: body({ subscription: subscription(mine) }),
        headers: colleague.headers,
      }),
    ]);
    for (const result of results) expect(result.status).toBeLessThan(500);
    expect((await liveFor(mine))[0]?.['count']).toBe(1);
    expect((await liveFor(theirs))[0]?.['count']).toBe(1);
  });

  it('a revoke and a PUT of the same install never leave a broken row', async () => {
    const colleague = await f.seedStaff('Synthetic colleague');
    const installation = nextId();
    await f.send('PUT', '/v1/staff/push/subscription', {
      body: body({ installation_id: installation }),
      headers: colleague.headers,
    });
    const results = await Promise.all([
      f.send('POST', '/v1/staff/push/subscription/revoke', {
        body: { installation_id: installation },
        headers: colleague.headers,
      }),
      f.send('PUT', '/v1/staff/push/subscription', {
        body: body({ installation_id: installation }),
        headers: colleague.headers,
      }),
    ]);
    for (const result of results) expect(result.status).toBeLessThan(500);
    const rows = await f.owner`SELECT endpoint,p256dh,auth,delivery_token,revoked_at
      FROM push_subscriptions WHERE company_id=${f.companyId} AND user_id=${colleague.userId}`;
    for (const row of rows) expect(validState(row)).toBe(true);
  });
});

describe('the life of one row', () => {
  it('a revoked install comes back as the same row, live again', async () => {
    const colleague = await f.seedStaff('Synthetic returning');
    const installation = nextId();
    await f.send('PUT', '/v1/staff/push/subscription', {
      body: body({ installation_id: installation }),
      headers: colleague.headers,
    });
    const [first] = await f.owner`SELECT id FROM push_subscriptions
      WHERE company_id=${f.companyId} AND user_id=${colleague.userId}`;
    await f.send('POST', '/v1/staff/push/subscription/revoke', {
      body: { installation_id: installation },
      headers: colleague.headers,
    });
    await f.send('PUT', '/v1/staff/push/subscription', {
      body: body({ installation_id: installation }),
      headers: colleague.headers,
    });
    const [again] = await f.owner`SELECT id,endpoint,p256dh,auth,delivery_token,generation,revoked_at,revoked_reason
      FROM push_subscriptions WHERE company_id=${f.companyId} AND user_id=${colleague.userId}`;
    expect(again?.['id']).toBe(first?.['id']);
    expect(again?.['endpoint']).not.toBeNull();
    expect(again?.['p256dh']).not.toBeNull();
    expect(again?.['auth']).not.toBeNull();
    expect(again?.['delivery_token']).not.toBeNull();
    expect(again?.['revoked_at']).toBeNull();
    expect(again?.['revoked_reason']).toBeNull();
    expect(again?.['generation']).toBe(3);
  });

  it('a second install on the same endpoint replaces the first', async () => {
    const colleague = await f.seedStaff('Synthetic replacing');
    const endpoint = `https://fcm.googleapis.com/fcm/send/${nextId()}`;
    await f.send('PUT', '/v1/staff/push/subscription', {
      body: body({ subscription: subscription(endpoint) }),
      headers: colleague.headers,
    });
    await f.send('PUT', '/v1/staff/push/subscription', {
      body: body({ subscription: subscription(endpoint) }),
      headers: colleague.headers,
    });
    const rows = await f.owner`SELECT revoked_at,revoked_reason FROM push_subscriptions
      WHERE company_id=${f.companyId} AND user_id=${colleague.userId}`;
    expect(rows.filter((row) => row['revoked_at'] !== null)).toHaveLength(1);
    expect(rows.find((row) => row['revoked_at'] !== null)?.['revoked_reason']).toBe('REPLACED');
    expect(rows.filter((row) => row['revoked_at'] === null)).toHaveLength(1);
  });

  it('the generation moves only when the endpoint, the keys or the token change', async () => {
    const colleague = await f.seedStaff('Synthetic counting');
    const installation = nextId();
    const endpoint = `https://fcm.googleapis.com/fcm/send/${nextId()}`;
    const other = `https://fcm.googleapis.com/fcm/send/${nextId()}`;
    const token = nextId();
    const keys = { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) };
    const otherKeys = { p256dh: 'q'.repeat(87), auth: 'a'.repeat(22) };
    const send = (over: Record<string, unknown> = {}) =>
      f.send('PUT', '/v1/staff/push/subscription', {
        body: {
          installation_id: installation,
          vapid_key_id: f.config.keyId,
          delivery_token: token,
          subscription: { endpoint, keys },
          locale: 'ar',
          ...over,
        },
        headers: colleague.headers,
      });
    await send();
    expect(await generationOf(colleague.userId, installation)).toBe(1);
    await send({ locale: 'en' });
    expect(await generationOf(colleague.userId, installation)).toBe(1);
    await send({ subscription: { endpoint: other, keys } });
    expect(await generationOf(colleague.userId, installation)).toBe(2);
    await send({ subscription: { endpoint: other, keys: otherKeys } });
    expect(await generationOf(colleague.userId, installation)).toBe(3);
    await send({ subscription: { endpoint: other, keys: otherKeys }, delivery_token: nextId() });
    expect(await generationOf(colleague.userId, installation)).toBe(4);
  });
});
