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
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const liveCountFor = async (userId: string) =>
  Number(
    (
      await f.owner`SELECT count(*)::int AS count FROM push_subscriptions
        WHERE company_id=${f.companyId} AND user_id=${userId} AND revoked_at IS NULL`
    )[0]?.['count'],
  );
const liveCount = async () => liveCountFor(f.userId);
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

it('subscribes, refreshes and unsubscribes, and the row holds the secrets only while it is live', async () => {
  const installation = nextId();
  const first = body({ installation_id: installation });
  expect((await f.send('PUT', '/v1/staff/push/subscription', { body: first })).status).toBe(204);
  const [row] = await f.owner`SELECT * FROM push_subscriptions
    WHERE company_id=${f.companyId} AND user_id=${f.userId} AND installation_hash IS NOT NULL`;
  expect(row?.['endpoint']).toBe(first.subscription.endpoint);
  expect(row?.['p256dh']).toBe('p'.repeat(87));
  expect(row?.['delivery_token']).toBe(first.delivery_token);
  expect(row?.['generation']).toBe(1);
  await wait(5);
  const refreshed = body({
    installation_id: installation,
    delivery_token: first.delivery_token,
    subscription: first.subscription,
    locale: 'en',
  });
  expect((await f.send('PUT', '/v1/staff/push/subscription', { body: refreshed })).status).toBe(
    204,
  );
  const [after] = await f.owner`SELECT * FROM push_subscriptions WHERE id=${row?.['id']}`;
  expect(after?.['locale']).toBe('en');
  expect(after?.['generation']).toBe(1);
  expect(new Date(after?.['last_seen_at']).getTime()).toBeGreaterThan(
    new Date(row?.['last_seen_at']).getTime(),
  );
  const revoked = await f.send('POST', '/v1/staff/push/subscription/revoke', {
    body: { installation_id: installation },
  });
  expect(revoked.status).toBe(204);
  const [gone] = await f.owner`SELECT * FROM push_subscriptions WHERE id=${row?.['id']}`;
  expect(gone?.['endpoint']).toBeNull();
  expect(gone?.['p256dh']).toBeNull();
  expect(gone?.['auth']).toBeNull();
  expect(gone?.['delivery_token']).toBeNull();
  expect(gone?.['revoked_reason']).toBe('UNSUBSCRIBED');
  expect(gone?.['generation']).toBe(2);
});

it('moves an endpoint to the second employee and revokes the first row as OWNER_CHANGED', async () => {
  const colleague = await f.seedStaff('Synthetic colleague');
  const endpoint = `https://fcm.googleapis.com/fcm/send/${nextId()}`;
  expect(
    (
      await f.send('PUT', '/v1/staff/push/subscription', {
        body: body({ subscription: subscription(endpoint) }),
      })
    ).status,
  ).toBe(204);
  expect(
    (
      await f.send('PUT', '/v1/staff/push/subscription', {
        body: body({ subscription: subscription(endpoint) }),
        headers: colleague.headers,
      })
    ).status,
  ).toBe(204);
  const rows = await f.owner`SELECT user_id,revoked_reason,revoked_at FROM push_subscriptions
    WHERE company_id=${f.companyId}
      AND endpoint_hash=(SELECT endpoint_hash FROM push_subscriptions
        WHERE company_id=${f.companyId} AND endpoint=${endpoint} LIMIT 1)`;
  expect(rows).toHaveLength(2);
  expect(rows.filter((row) => row['revoked_at'] !== null)).toHaveLength(1);
  expect(rows.find((row) => row['revoked_at'] !== null)?.['revoked_reason']).toBe('OWNER_CHANGED');
  expect(rows.find((row) => row['revoked_at'] === null)?.['user_id']).toBe(colleague.userId);
});

it('revokes the oldest subscription when the cap is exceeded and keeps a refresh at the cap', async () => {
  const installations: string[] = [];
  for (let n = 0; n < 5; n += 1) {
    const installation = nextId();
    installations.push(installation);
    expect(
      (
        await f.send('PUT', '/v1/staff/push/subscription', {
          body: body({ installation_id: installation }),
        })
      ).status,
    ).toBe(204);
    await wait(5);
  }
  expect(await liveCount()).toBe(5);
  expect(
    (
      await f.send('PUT', '/v1/staff/push/subscription', {
        body: body({ installation_id: installations[0] }),
      })
    ).status,
  ).toBe(204);
  expect(await liveCount()).toBe(5);
  expect((await f.send('PUT', '/v1/staff/push/subscription', { body: body() })).status).toBe(204);
  const oldest = installationHash(f.companyId, installations[0] ?? '').toString('hex');
  const revoked = await f.owner`SELECT revoked_reason,encode(installation_hash,'hex') AS hash
    FROM push_subscriptions
    WHERE company_id=${f.companyId} AND user_id=${f.userId} AND revoked_at IS NOT NULL
      AND encode(installation_hash,'hex')=${oldest}`;
  expect(revoked).toHaveLength(1);
  expect(revoked[0]?.['revoked_reason']).toBe('CAP_EXCEEDED');
});

it('refuses a reception session, an admin session and no session, and stores nothing', async () => {
  const before = await ownCount();
  const principals = [
    { cookie: await f.receptionCookie(), origin: 'http://localhost:5173' },
    { cookie: await f.adminCookie(), origin: 'http://admin.test' },
    { cookie: '', origin: 'http://localhost:5173' },
  ];
  for (const headers of principals) {
    for (const [method, url, payload] of [
      ['GET', '/v1/staff/push/config', undefined],
      ['PUT', '/v1/staff/push/subscription', body()],
      ['POST', '/v1/staff/push/subscription/revoke', { installation_id: nextId() }],
    ] as const) {
      const result = await f.send(method, url, {
        headers,
        ...(payload === undefined ? {} : { body: payload }),
      });
      expect(result.status, `${method} ${url}`).toBe(401);
    }
  }
  expect(await ownCount()).toBe(before);
});

it('answers NOT_READY and stores nothing when push is not configured', async () => {
  const unconfigured = await pushFixture({ configured: false });
  try {
    expect((await unconfigured.send('GET', '/v1/staff/push/config')).status).toBe(503);
    expect(
      (await unconfigured.send('PUT', '/v1/staff/push/subscription', { body: body() })).status,
    ).toBe(503);
    expect((await unconfigured.owner`SELECT id FROM push_subscriptions`).length).toBe(0);
  } finally {
    await unconfigured.close();
  }
});

it('keeps five live rows when eight registrations race, and never leaves a duplicate endpoint', async () => {
  const racer = await f.seedStaff('Synthetic racer');
  const bodies = Array.from({ length: 8 }, () => body());
  const results = await Promise.all(
    bodies.map((value) =>
      f.send('PUT', '/v1/staff/push/subscription', { body: value, headers: racer.headers }),
    ),
  );
  expect(results.map((result) => result.status)).toEqual(Array(8).fill(204));
  expect(await liveCountFor(racer.userId)).toBe(5);
  const revoked = await f.owner`SELECT count(*)::int AS count FROM push_subscriptions
    WHERE company_id=${f.companyId} AND user_id=${racer.userId} AND revoked_reason='CAP_EXCEEDED'`;
  expect(revoked[0]?.['count']).toBe(3);
});

it('stores no raw installation id and scopes the hash to the company', async () => {
  const installation = nextId();
  expect(
    (
      await f.send('PUT', '/v1/staff/push/subscription', {
        body: body({ installation_id: installation }),
      })
    ).status,
  ).toBe(204);
  const rows = await f.owner`SELECT * FROM push_subscriptions WHERE company_id=${f.companyId}`;
  for (const row of rows)
    for (const value of Object.values(row)) expect(String(value)).not.toContain(installation);
  const other = await f.seedCompany('Synthetic second company');
  expect(
    (
      await f.send('PUT', '/v1/staff/push/subscription', {
        body: body({ installation_id: installation }),
        headers: other.headers,
      })
    ).status,
  ).toBe(204);
  const here = installationHash(f.companyId, installation).toString('hex');
  const there = installationHash(other.companyId, installation).toString('hex');
  expect(here).not.toBe(there);
  const stored = await f.owner`SELECT company_id,encode(installation_hash,'hex') AS hash
    FROM push_subscriptions WHERE encode(installation_hash,'hex') IN (${here},${there})`;
  expect(stored).toHaveLength(2);
  await f.primarySession();
});

it('refuses a registration made under another key and stores nothing', async () => {
  const before = await ownCount();
  const result = await f.send('PUT', '/v1/staff/push/subscription', {
    body: body({ vapid_key_id: 'fedcba9876543210' }),
  });
  expect(result.status).toBe(409);
  expect(result.body['code']).toBe('PUSH_KEY_STALE');
  expect(await ownCount()).toBe(before);
});

it('serves the caller own subscriber reference', async () => {
  const mine = await f.send('GET', '/v1/staff/push/config');
  expect(mine.status).toBe(200);
  expect(mine.body['vapid_public_key']).toBe(f.config.publicKey);
  expect(mine.body['vapid_key_id']).toBe(f.config.keyId);
  const colleague = await f.seedStaff('Synthetic other user');
  const theirs = await f.send('GET', '/v1/staff/push/config', { headers: colleague.headers });
  expect(theirs.body['subscriber_ref']).not.toBe(mine.body['subscriber_ref']);
  const other = await f.seedCompany('Synthetic third company');
  const elsewhere = await f.send('GET', '/v1/staff/push/config', { headers: other.headers });
  expect(elsewhere.body['subscriber_ref']).toBe(mine.body['subscriber_ref']);
  await f.primarySession();
});

it('refuses an endpoint that is not an allowed push service', async () => {
  const before = await ownCount();
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/synthetic',
    'https://fcm.googleapis.com@evil.test/fcm/send/synthetic',
    'https://fcm.googleapis.com:8443/fcm/send/synthetic',
    'https://127.0.0.1/fcm/send/synthetic',
    'https://fcm.googleapis.com.evil.test/fcm/send/synthetic',
  ]) {
    const result = await f.send('PUT', '/v1/staff/push/subscription', {
      body: body({ subscription: subscription(endpoint) }),
    });
    expect(result.status, endpoint).toBe(400);
    expect(result.body['code']).toBe('VALIDATION_FAILED');
  }
  expect(await ownCount()).toBe(before);
});

it('answers 204 for an unknown install id and never revokes another employee row', async () => {
  const stranger = await f.seedStaff('Synthetic stranger');
  const theirInstallation = nextId();
  expect(
    (
      await f.send('PUT', '/v1/staff/push/subscription', {
        body: body({ installation_id: theirInstallation }),
        headers: stranger.headers,
      })
    ).status,
  ).toBe(204);
  const before = await f.owner`SELECT id,revoked_at FROM push_subscriptions ORDER BY id`;
  expect(
    (
      await f.send('POST', '/v1/staff/push/subscription/revoke', {
        body: { installation_id: nextId() },
      })
    ).status,
  ).toBe(204);
  expect(
    (
      await f.send('POST', '/v1/staff/push/subscription/revoke', {
        body: { installation_id: theirInstallation },
      })
    ).status,
  ).toBe(204);
  expect(await f.owner`SELECT id,revoked_at FROM push_subscriptions ORDER BY id`).toEqual(before);
});
