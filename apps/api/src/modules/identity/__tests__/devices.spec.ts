import { errorEnvelope } from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { systemClock } from '../../../shared/adapters/system-clock.ts';
import { createRedisPairingCodes } from '../persistence/redis-pairing-codes.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';

// T9b-2 through the API with real sessions, Postgres and Redis: pair → register (PENDING) → approve → claim the token
// once → the device authenticates and is renewed on contact → revoke → its next contact is refused.
// spec 071: issuing a code replaces the branch's live code, the registration is atomic against that
// replacement, and the check code is the same on the device and in the manager's list.
let h: Harness;
let owner: string;
let company: string;
let branch: string;
let otherBranch: string;

// المسارات العامة محدودة المعدّل لكل عنوان؛ كل مجموعة اختبارات جديدة ليها عنوان خاص، فما بتاخدش
// ميزانية الملف الأصلي.
const PAIR_IP = '10.71.0.1';
const RACE_IP = '10.71.0.2';

// خطّاف بيشتغل جوّه الـ transaction بعد إدراج الجهاز: عشان نبدّل كود الربط وهو لسه في الطريق.
let raceHook: (() => Promise<void>) | null = null;

const dialect = new PgDialect();

function watchDeviceInsert(tx: Tx): Tx {
  return new Proxy(tx, {
    get: (target, property, receiver) =>
      property === 'execute'
        ? async (query: SQL) => {
            const result = await target.execute(query);
            if (dialect.sqlToQuery(query).sql.includes('INSERT INTO devices')) {
              const hook = raceHook;
              raceHook = null;
              if (hook !== null) await hook();
            }
            return result;
          }
        : Reflect.get(target, property, receiver),
  });
}

beforeAll(async () => {
  h = await startHarness({
    wrapDatabase: (database: TenantWrappers): TenantWrappers => ({
      ...database,
      withTenant: (companyId, fn, options) =>
        database.withTenant(
          companyId,
          (tx) => fn(raceHook === null ? tx : watchDeviceInsert(tx)),
          options,
        ),
    }),
  });
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
  remoteAddress?: string,
) =>
  h.app.inject({
    method,
    url,
    headers,
    ...(body === undefined ? {} : { payload: body }),
    ...(remoteAddress === undefined ? {} : { remoteAddress }),
  });

async function pairingCode(): Promise<string> {
  const res = await h.send('POST', `/v1/branches/${branch}/devices/pairing-code`, {
    cookie: owner,
    company,
  });
  expect(res.status).toBe(201);
  return res.body['code'] as string;
}

async function pairingCodeFor(branchId: string): Promise<string> {
  const res = await h.send('POST', `/v1/branches/${branchId}/devices/pairing-code`, {
    cookie: owner,
    company,
  });
  expect(res.status).toBe(201);
  return res.body['code'] as string;
}

async function registered(label: string, remoteAddress?: string) {
  const res = await json(
    'POST',
    '/v1/devices/register',
    { pairing_code: await pairingCode(), label },
    {},
    remoteAddress,
  );
  expect(res.statusCode).toBe(201);
  return res.json() as {
    company_id: string;
    device_id: string;
    claim_secret: string;
    check_code: string;
  };
}

const claim = (
  device: { company_id: string; device_id: string; claim_secret: string },
  remoteAddress?: string,
) =>
  json(
    'POST',
    '/v1/devices/claim',
    {
      company_id: device.company_id,
      device_id: device.device_id,
      claim_secret: device.claim_secret,
    },
    {},
    remoteAddress,
  );
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

// شركة تانية بفرعها وكود ربط حي، عشان نثبت إن كودها ما بيلمسش كود فرعنا.
async function issueForeignCompanyCode(): Promise<void> {
  const otherOwner = await h.signedInOperator('devices-other-owner@example.test');
  const otherCompany = await h.onboard(otherOwner, 'Other Devices Co');
  const otherBusiness = await h.send('POST', '/v1/businesses', {
    cookie: otherOwner,
    company: otherCompany,
    key: 'dev-other-business',
    body: { vertical_type: 'restaurant', name_en: 'Other Diner' },
  });
  const otherBranchOfOther = (
    await h.send('POST', `/v1/businesses/${otherBusiness.body['id'] as string}/branches`, {
      cookie: otherOwner,
      company: otherCompany,
      key: 'dev-other-branch',
      body: { name_en: 'Other branch' },
    })
  ).body['id'] as string;
  const foreign = await h.send('POST', `/v1/branches/${otherBranchOfOther}/devices/pairing-code`, {
    cookie: otherOwner,
    company: otherCompany,
  });
  expect(foreign.status).toBe(201);
}

describe('replacing the pairing code', () => {
  it('a code the manager replaced is refused, and the new one works', async () => {
    const old = await pairingCode();
    const fresh = await pairingCode();
    expect(fresh).not.toBe(old);
    const refused = await json(
      'POST',
      '/v1/devices/register',
      { pairing_code: old, label: 'Replaced till' },
      {},
      PAIR_IP,
    );
    expect([refused.statusCode, errorEnvelope.parse(refused.json()).code]).toEqual([
      400,
      'PAIRING_CODE_INVALID',
    ]);
    const accepted = await json(
      'POST',
      '/v1/devices/register',
      { pairing_code: fresh, label: 'Fresh till' },
      {},
      PAIR_IP,
    );
    expect(accepted.statusCode).toBe(201);
  });

  it('a code of another branch or another company leaves this branch’s code working', async () => {
    const mine = await pairingCode();
    await pairingCodeFor(otherBranch);
    await issueForeignCompanyCode();
    const accepted = await json(
      'POST',
      '/v1/devices/register',
      { pairing_code: mine, label: 'Untouched till' },
      {},
      PAIR_IP,
    );
    expect(accepted.statusCode).toBe(201);
  });
});

describe('the race between a registration and a replaced code', () => {
  it('rolls the registration back and refuses it, and the new code still works', async () => {
    const codes = createRedisPairingCodes(h.redis, systemClock);
    const first = await codes.issue({ companyId: company, branchId: branch });
    let replacement = '';
    raceHook = async () => {
      const issued = await codes.issue({ companyId: company, branchId: branch });
      replacement = issued.code;
    };
    const before = await h.owner`SELECT count(*)::int AS count FROM devices`;
    const auditBefore =
      await h.owner`SELECT count(*)::int AS count FROM audit_log WHERE action = 'device.registered'`;
    const outboxBefore =
      await h.owner`SELECT count(*)::int AS count FROM outbox WHERE event_type = 'DeviceRegistered'`;
    const res = await json(
      'POST',
      '/v1/devices/register',
      { pairing_code: first.code, label: 'Racing till' },
      {},
      RACE_IP,
    );
    expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([
      400,
      'PAIRING_CODE_INVALID',
    ]);
    expect(replacement).not.toBe('');
    expect(replacement).not.toBe(first.code);
    const after = await h.owner`SELECT count(*)::int AS count FROM devices`;
    expect(after[0]?.count).toBe(before[0]?.count);
    const auditAfter =
      await h.owner`SELECT count(*)::int AS count FROM audit_log WHERE action = 'device.registered'`;
    expect(auditAfter[0]?.count).toBe(auditBefore[0]?.count);
    const outboxAfter =
      await h.owner`SELECT count(*)::int AS count FROM outbox WHERE event_type = 'DeviceRegistered'`;
    expect(outboxAfter[0]?.count).toBe(outboxBefore[0]?.count);
    const accepted = await json(
      'POST',
      '/v1/devices/register',
      { pairing_code: replacement, label: 'Racing till' },
      {},
      RACE_IP,
    );
    expect(accepted.statusCode).toBe(201);
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

describe('the Device scheme', () => {
  it('is case-insensitive and wins over a session cookie', async () => {
    const device = await registered('Lowercase till');
    await approve(device.device_id);
    const token = ((await claim(device)).json() as { device_token: string }).device_token;
    const res = await json('GET', '/v1/devices/me', undefined, {
      authorization: `device ${token}`,
      cookie: owner,
    });
    expect([res.statusCode, (res.json() as { device_id: string }).device_id]).toEqual([
      200,
      device.device_id,
    ]);
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

describe('a malformed device id', () => {
  it('is a 400 VALIDATION_FAILED on approve and on revoke', async () => {
    for (const action of ['approve', 'revoke']) {
      const res = await h.send('POST', `/v1/branches/${branch}/devices/not-a-uuid/${action}`, {
        cookie: owner,
        company,
      });
      expect(res.status).toBe(400);
      expect(res.body['code']).toBe('VALIDATION_FAILED');
    }
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
