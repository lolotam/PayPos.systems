import { errorEnvelope } from '@pospay/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// T9b-2 through the API with real sessions, Postgres and Redis: pair → register (PENDING) → approve → claim the token
// once → the device authenticates and is renewed on contact → revoke → its next contact is refused.
let h: Harness;
let owner: string;
let company: string;
let branch: string;
let otherBranch: string;

beforeAll(async () => {
  h = await startHarness();
  owner = await h.signedInOperator('devices-owner@example.test');
  company = await h.onboard(owner, 'Devices Co');
  const business = await h.send('POST', '/v1/businesses', {
    cookie: owner,
    company,
    key: 'dev-business',
    body: { vertical_type: 'restaurant', name_en: 'Diner' },
  });
  const branchOf = async (key: string) =>
    (
      await h.send('POST', `/v1/businesses/${business.body['id'] as string}/branches`, {
        cookie: owner,
        company,
        key,
        body: { name_en: key },
      })
    ).body['id'] as string;
  branch = await branchOf('dev-branch-1');
  otherBranch = await branchOf('dev-branch-2');
});

afterAll(async () => {
  await h.close();
});

const json = (
  method: 'GET' | 'POST',
  url: string,
  body?: object,
  headers: Record<string, string> = {},
) => h.app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body }) });

async function pairingCode(): Promise<string> {
  const res = await h.send('POST', `/v1/branches/${branch}/devices/pairing-code`, {
    cookie: owner,
    company,
  });
  expect(res.status).toBe(201);
  return res.body['code'] as string;
}

async function registered(label: string) {
  const res = await json('POST', '/v1/devices/register', {
    pairing_code: await pairingCode(),
    label,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { company_id: string; device_id: string; claim_secret: string };
}

const claim = (device: { company_id: string; device_id: string; claim_secret: string }) =>
  json('POST', '/v1/devices/claim', device);
const approve = (deviceId: string, onBranch = branch) =>
  h.send('POST', `/v1/branches/${onBranch}/devices/${deviceId}/approve`, {
    cookie: owner,
    company,
  });
const me = (token: string) =>
  json('GET', '/v1/devices/me', undefined, { authorization: `Device ${token}` });

describe('pairing and registration', () => {
  it('a code works once, and a wrong or used code is the same 400', async () => {
    const code = await pairingCode();
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
    expect(
      (await json('POST', '/v1/devices/register', { pairing_code: code, label: 'Till' }))
        .statusCode,
    ).toBe(201);
    for (const again of [code, 'ZZZZZZZZ']) {
      const res = await json('POST', '/v1/devices/register', {
        pairing_code: again,
        label: 'Till',
      });
      expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([
        400,
        'PAIRING_CODE_INVALID',
      ]);
    }
  });

  it('a registered device waits for approval: claiming before it is 409 DEVICE_PENDING', async () => {
    const device = await registered('Waiting till');
    const res = await claim(device);
    expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([409, 'DEVICE_PENDING']);
  });
});

describe('approval and the one-time token', () => {
  it('approve, claim once, authenticate — the claim secret does not work twice', async () => {
    const device = await registered('Front till');
    expect((await approve(device.device_id, otherBranch)).status).toBe(409);
    expect((await approve(device.device_id)).status).toBe(204);
    const claimed = await claim(device);
    expect(claimed.statusCode).toBe(200);
    const token = (claimed.json() as { device_token: string }).device_token;
    expect(token).toMatch(new RegExp(`^pd_${device.company_id}\\.${device.device_id}\\.`));
    expect((await claim(device)).statusCode).toBe(401);
    const who = await me(token);
    expect([who.statusCode, who.json()]).toEqual([
      200,
      { device_id: device.device_id, company_id: company, branch_id: branch },
    ]);
  });

  it('each contact renews the token for 30 days (D-09)', async () => {
    const device = await registered('Renewed till');
    await approve(device.device_id);
    const token = ((await claim(device)).json() as { device_token: string }).device_token;
    await h.owner`UPDATE devices SET token_expires_at = now() + interval '1 day' WHERE id = ${device.device_id}`;
    expect((await me(token)).statusCode).toBe(200);
    const [row] =
      await h.owner`SELECT token_expires_at > now() + interval '29 days' AS renewed FROM devices WHERE id = ${device.device_id}`;
    expect(row).toEqual({ renewed: true });
  });

  it('an expired token, a forged company and a garbled token are the same 401', async () => {
    const device = await registered('Expired till');
    await approve(device.device_id);
    const token = ((await claim(device)).json() as { device_token: string }).device_token;
    const forged = token.replace(device.company_id, '01920000-0000-7000-8000-00000000ffff');
    await h.owner`UPDATE devices SET token_expires_at = now() - interval '1 second' WHERE id = ${device.device_id}`;
    for (const bad of [token, forged, 'pd_garbage']) expect((await me(bad)).statusCode).toBe(401);
  });
});

describe('revocation', () => {
  it('a revoked device is refused on its next contact, with an audit trail and DeviceRevoked', async () => {
    const device = await registered('Revoked till');
    await approve(device.device_id);
    const token = ((await claim(device)).json() as { device_token: string }).device_token;
    expect((await me(token)).statusCode).toBe(200);
    const revoked = await h.send(
      'POST',
      `/v1/branches/${branch}/devices/${device.device_id}/revoke`,
      {
        cookie: owner,
        company,
      },
    );
    expect(revoked.status).toBe(204);
    expect((await me(token)).statusCode).toBe(401);
    const actions =
      await h.owner`SELECT action FROM audit_log WHERE entity_id = ${device.device_id} ORDER BY at, id`;
    expect(actions.map((a) => a['action'])).toEqual([
      'device.registered',
      'device.approved',
      'device.token_issued',
      'device.revoked',
    ]);
    const events =
      await h.owner`SELECT event_type FROM outbox WHERE aggregate_id = ${device.device_id} ORDER BY seq`;
    expect(events.map((e) => e['event_type'])).toEqual(['DeviceRegistered', 'DeviceRevoked']);
    const [stored] =
      await h.owner`SELECT token_hash, claim_hash FROM devices WHERE id = ${device.device_id}`;
    expect(stored).toEqual({ token_hash: null, claim_hash: null });
  });
});

describe('abuse of the public routes', () => {
  it('a device principal cannot use a manager route', async () => {
    const device = await registered('Nosy till');
    await approve(device.device_id);
    const token = ((await claim(device)).json() as { device_token: string }).device_token;
    const res = await json('POST', `/v1/branches/${branch}/devices/pairing-code`, undefined, {
      authorization: `Device ${token}`,
      'x-company-id': company,
    });
    expect(res.statusCode).toBe(403);
  });
});

// Last: it uses up this client's claim attempts for the window.
describe('rate limiting', () => {
  it('the public claim route is rate-limited per client', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      statuses.push(
        (
          await json('POST', '/v1/devices/claim', {
            company_id: company,
            device_id: '01920000-0000-7000-8000-000000000000',
            claim_secret: 'nope',
          })
        ).statusCode,
      );
    }
    expect(statuses).toContain(429);
  });
});
