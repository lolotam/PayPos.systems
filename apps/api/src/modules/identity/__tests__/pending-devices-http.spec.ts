import { errorEnvelope, pendingDevicesResponse } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// The manager lists the devices waiting for approval, so the M-1c iOS check can find the device it just paired.
let h: Harness;
let owner: string;
let company: string;
let business: string;
let branch: string;
let otherBranch: string;
let cashier: string;
let branchManager: string;

function roleId(code: string): string {
  const found = SYSTEM_ROLES.find((role) => role.code === code);
  if (found === undefined) throw new Error(`missing role ${code}`);
  return found.id;
}

async function createBranch(key: string, name: string): Promise<string> {
  const res = await h.send('POST', `/v1/businesses/${business}/branches`, {
    cookie: owner,
    company,
    key,
    body: { name_en: name },
  });
  expect(res.status).toBe(201);
  return res.body['id'] as string;
}

// A member of the company whose role and scope decide what the caller may manage.
async function member(
  email: string,
  role: string,
  scopeType: 'COMPANY' | 'BRANCH',
  scopeId: string,
): Promise<string> {
  const cookie = await h.signedInOperator(email);
  const [holder] = await h.owner`SELECT id FROM "user" WHERE email = ${email}`;
  await h.owner`INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
    VALUES (${company}, ${randomUUID()}, ${holder?.['id'] as string}, ${roleId(role)}, 'global', ${scopeType}, ${scopeId})`;
  return cookie;
}

async function pairingCode(): Promise<string> {
  const res = await h.send('POST', `/v1/branches/${branch}/devices/pairing-code`, {
    cookie: owner,
    company,
  });
  expect(res.status).toBe(201);
  return res.body['code'] as string;
}

async function register(label: string): Promise<string> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: await pairingCode(), label },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { device_id: string }).device_id;
}

function list(query: string, cookie = owner) {
  return h.send('GET', `/v1/branches/${branch}/devices${query}`, { cookie, company });
}

beforeAll(async () => {
  h = await startHarness();
  owner = await h.signedInOperator('pending-devices-owner@example.test');
  company = await h.onboard(owner, 'Pending Devices Co');
  const created = await h.send('POST', '/v1/businesses', {
    cookie: owner,
    company,
    key: 'pending-devices-business',
    body: { vertical_type: 'restaurant', name_en: 'Diner' },
  });
  business = created.body['id'] as string;
  branch = await createBranch('pending-devices-branch', 'Till branch');
  otherBranch = await createBranch('pending-devices-branch-2', 'Other branch');
  cashier = await member('pending-devices-cashier@example.test', 'cashier', 'COMPANY', company);
  branchManager = await member(
    'pending-devices-manager@example.test',
    'branch_manager',
    'BRANCH',
    otherBranch,
  );
});

afterAll(async () => {
  await h.close();
});

describe('GET /v1/branches/{branch}/devices', () => {
  it('lists the branch pending devices for a manager who can manage the branch', async () => {
    const deviceId = await register('Waiting till');
    const res = await list('?status=pending');
    expect(res.status).toBe(200);
    const body = pendingDevicesResponse.parse(res.body);
    expect(Object.keys(res.body)).toEqual(['items']);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: deviceId, label: 'Waiting till' });
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual(['created_at', 'id', 'label']);
    expect(JSON.stringify(res.body)).not.toContain('claim_hash');
  });

  it('refuses a missing status and a status other than pending', async () => {
    for (const query of ['', '?status=active']) {
      const res = await list(query);
      expect([res.status, errorEnvelope.parse(res.body).code]).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('refuses a caller without manage:devices:branch', async () => {
    const res = await list('?status=pending', cashier);
    expect([res.status, errorEnvelope.parse(res.body).code]).toEqual([403, 'FORBIDDEN']);
  });

  it('refuses a manager of another branch of the same company', async () => {
    const deviceId = await register('Hidden till');
    const res = await list('?status=pending', branchManager);
    expect([res.status, errorEnvelope.parse(res.body).code]).toEqual([403, 'FORBIDDEN']);
    expect(JSON.stringify(res.body)).not.toContain(deviceId);
  });
});
