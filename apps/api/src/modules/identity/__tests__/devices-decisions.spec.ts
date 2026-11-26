import { computeDeviceCheckCode } from '@pospay/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// قرارات المدير على الأجهزة (spec 071): سجل الموافقة والرفض والإزالة، وكود المطابقة اللي
// بيظهر على شاشة الجهاز نفسه.
let h: Harness;
let owner: string;
let company: string;
let branch: string;

// المسارات العامة محدودة المعدّل لكل عنوان؛ كل مجموعة اختبارات ليها عنوان خاص.
const AUDIT_IP = '10.71.0.3';
const CODE_IP = '10.71.0.4';

beforeAll(async () => {
  h = await startHarness();
  owner = await h.signedInOperator('devices-decisions-owner@example.test');
  company = await h.onboard(owner, 'Devices Decisions Co');
  const business = await h.send('POST', '/v1/businesses', {
    cookie: owner,
    company,
    key: 'dev-decisions-business',
    body: { vertical_type: 'restaurant', name_en: 'Diner' },
  });
  branch = (
    await h.send('POST', `/v1/businesses/${business.body['id'] as string}/branches`, {
      cookie: owner,
      company,
      key: 'dev-decisions-branch',
      body: { name_en: 'Decisions branch' },
    })
  ).body['id'] as string;
});

afterAll(async () => {
  await h.close();
});

async function pairingCode(): Promise<string> {
  const res = await h.send('POST', `/v1/branches/${branch}/devices/pairing-code`, {
    cookie: owner,
    company,
  });
  expect(res.status).toBe(201);
  return res.body['code'] as string;
}

async function registered(label: string, remoteAddress?: string) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: await pairingCode(), label },
    ...(remoteAddress === undefined ? {} : { remoteAddress }),
  });
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
  h.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    payload: {
      company_id: device.company_id,
      device_id: device.device_id,
      claim_secret: device.claim_secret,
    },
    ...(remoteAddress === undefined ? {} : { remoteAddress }),
  });

const approve = (deviceId: string) =>
  h.send('POST', `/v1/branches/${branch}/devices/${deviceId}/approve`, {
    cookie: owner,
    company,
  });
const revoke = (deviceId: string) =>
  h.send('POST', `/v1/branches/${branch}/devices/${deviceId}/revoke`, {
    cookie: owner,
    company,
  });
const me = (token: string) =>
  h.app.inject({
    method: 'GET',
    url: '/v1/devices/me',
    headers: { authorization: `Device ${token}` },
  });
const pendingList = () =>
  h.send('GET', `/v1/branches/${branch}/devices?status=pending`, { cookie: owner, company });

describe('the audit trail of the device decisions', () => {
  it('approving a pending device writes device.approved with the states around it', async () => {
    const device = await registered('Approved till', AUDIT_IP);
    expect((await approve(device.device_id)).status).toBe(204);
    const rows = await h.owner`SELECT action, before, after FROM audit_log
      WHERE entity_id = ${device.device_id} AND action = 'device.approved'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['before']).toEqual({ status: 'PENDING' });
    expect(rows[0]?.['after']).toEqual({ status: 'ACTIVE' });
  });

  it('refusing a pending device writes device.revoked and the device cannot claim its token', async () => {
    const device = await registered('Refused till', AUDIT_IP);
    expect((await revoke(device.device_id)).status).toBe(204);
    const rows = await h.owner`SELECT action, before, after FROM audit_log
      WHERE entity_id = ${device.device_id} AND action = 'device.revoked'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['before']).toEqual({ status: 'PENDING' });
    expect(rows[0]?.['after']).toEqual({ status: 'REVOKED' });
    expect((await claim(device, AUDIT_IP)).statusCode).toBe(401);
  });

  it('removing an active device writes device.revoked and the device loses its access', async () => {
    const device = await registered('Removed till', AUDIT_IP);
    expect((await approve(device.device_id)).status).toBe(204);
    const token = ((await claim(device, AUDIT_IP)).json() as { device_token: string }).device_token;
    expect((await me(token)).statusCode).toBe(200);
    expect((await revoke(device.device_id)).status).toBe(204);
    const rows = await h.owner`SELECT action, before, after FROM audit_log
      WHERE entity_id = ${device.device_id} AND action = 'device.revoked'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['before']).toEqual({ status: 'ACTIVE' });
    expect(rows[0]?.['after']).toEqual({ status: 'REVOKED' });
    expect((await me(token)).statusCode).toBe(401);
  });
});

describe('the check code', () => {
  it('is the same on the device and in the manager’s list', async () => {
    const device = await registered('Checked till', CODE_IP);
    expect(device.check_code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    const list = await pendingList();
    expect(list.status).toBe(200);
    const items = list.body['items'] as { id: string; check_code: string }[];
    const row = items.find((item) => item.id === device.device_id);
    expect(row?.check_code).toBe(device.check_code);
  });

  it('gives two devices of the same millisecond different codes', async () => {
    const first = '01920000-0000-7000-8000-00000000aa01';
    const second = '01920000-0000-7000-8000-00000000aa02';
    await h.owner`INSERT INTO devices (company_id, id, branch_id, label, status, created_at)
      VALUES (${company}, ${first}, ${branch}, 'Same moment one', 'PENDING', '2026-03-01T00:00:00Z'::timestamptz),
             (${company}, ${second}, ${branch}, 'Same moment two', 'PENDING', '2026-03-01T00:00:00Z'::timestamptz)`;
    const list = await pendingList();
    const items = list.body['items'] as { id: string; check_code: string }[];
    const codes = new Map(
      items
        .filter((item) => item.id === first || item.id === second)
        .map((item) => [item.id, item.check_code]),
    );
    expect(codes.size).toBe(2);
    expect(codes.get(first)).not.toBe(codes.get(second));
    expect(codes.get(first)).toBe(computeDeviceCheckCode(first));
    expect(codes.get(second)).toBe(computeDeviceCheckCode(second));
  });
});
