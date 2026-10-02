import { attendanceQrIssue, errorEnvelope } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { attendanceQrSecretScope, attendanceQrWindow } from '../domain/attendance-qr.ts';
import { hmacAttendanceQr } from '../persistence/hmac-attendance-qr.ts';
import { createRedisAttendanceQrSecrets } from '../persistence/redis-attendance-qr-secrets.ts';
import { createAttendanceBranchReader } from '../persistence/tenancy-attendance-branch.adapter.ts';
import { createDatabase } from '@pospay/db';
import { VerifyAttendanceQr } from '../use-cases/verify-attendance-qr/verify-attendance-qr.ts';

let h: Harness;
let owner: string;
let company: string;
let branch: string;
let deviceId: string;
let deviceToken: string;
const URL = '/v1/devices/me/attendance-qr';

async function pair() {
  const code = await h.send('POST', `/v1/branches/${branch}/devices/pairing-code`, {
    cookie: owner,
    company,
  });
  const registration = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: code.body['code'], label: 'Test attendance display' },
  });
  const registered = registration.json() as {
    device_id: string;
    company_id: string;
    claim_secret: string;
  };
  deviceId = registered.device_id;
  await h.send('POST', `/v1/branches/${branch}/devices/${deviceId}/approve`, {
    cookie: owner,
    company,
  });
  const claim = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    payload: registered,
  });
  deviceToken = (claim.json() as { device_token: string }).device_token;
}

beforeAll(async () => {
  h = await startHarness();
  owner = await h.signedInOperator('attendance-qr@example.test');
  company = await h.onboard(owner, 'Attendance QR Co');
  const business = await h.send('POST', '/v1/businesses', {
    cookie: owner,
    company,
    key: 'qr-business',
    body: { vertical_type: 'salon', name_en: 'Test salon', timezone: 'Asia/Qatar' },
  });
  const created = await h.send('POST', `/v1/businesses/${String(business.body['id'])}/branches`, {
    cookie: owner,
    company,
    key: 'qr-branch',
    body: { name_en: 'Test reception', name_ar: 'فرع الاختبار' },
  });
  branch = String(created.body['id']);
  await pair();
});

afterAll(async () => {
  await h.close();
});

const issue = (headers: Record<string, string> = {}) =>
  h.app.inject({
    method: 'POST',
    url: URL,
    headers: { authorization: `Device ${deviceToken}`, ...headers },
  });

it('returns the contract, branch timezone fallback and no-store, ignoring a forged company header', async () => {
  const res = await issue({ 'x-company-id': '01920000-0000-7000-8000-000000000099' });
  expect(res.statusCode).toBe(200);
  const body = attendanceQrIssue.parse(res.json());
  expect(body.branch).toEqual({
    id: branch,
    name_en: 'Test reception',
    name_ar: 'فرع الاختبار',
    effective_timezone: 'Asia/Qatar',
  });
  expect(body.token.branch_id).toBe(branch);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(body.token.window).toBe(attendanceQrWindow(Date.parse(body.server_time)));
  expect(Date.parse(body.expires_at) - Date.parse(body.refresh_at)).toBe(60_000);
  expect(Object.keys(body.token).sort()).toEqual(['branch_id', 'sig', 'window']);
  const verify = new VerifyAttendanceQr(createRedisAttendanceQrSecrets(h.redis), hmacAttendanceQr, {
    now: () => new Date(body.server_time),
  });
  expect(await verify.execute({ companyId: company, branchId: branch, token: body.token })).toBe(
    true,
  );
});

it('rejects missing/forged device proof and a manager cookie', async () => {
  expect((await h.app.inject({ method: 'POST', url: URL })).statusCode).toBe(401);
  expect((await issue({ authorization: 'Device synthetic-forgery' })).statusCode).toBe(401);
  expect((await h.send('POST', URL, { cookie: owner, company })).status).toBe(403);
});

it('shares daily Redis secrets atomically across adapters and retains the previous-day key', async () => {
  const now = Date.now();
  const scope = attendanceQrSecretScope(
    company,
    '01920000-0000-7000-8000-000000000088',
    attendanceQrWindow(now),
  );
  const first = createRedisAttendanceQrSecrets(h.redis);
  const second = createRedisAttendanceQrSecrets(h.redis);
  const values = await Promise.all(
    Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).getOrCreate(scope)),
  );
  expect(new Set(values).size).toBe(1);
  const stored = await second.read(scope);
  expect(stored).toBe(values[0]);
  const ttl = await h.redis.pttl(`attendance-qr:${company}:${scope.branchId}:${scope.day}`);
  expect(ttl).toBeGreaterThan(0);
  expect(Math.abs(ttl - (scope.retainUntil - Date.now()))).toBeLessThan(2000);
  const futureScope = {
    ...scope,
    day: scope.day + 1,
    retainUntil: scope.retainUntil + 86_400_000,
  };
  expect(await first.getOrCreate(futureScope)).not.toBe(stored);
  expect(await second.read(scope)).toBe(stored);
});

it('the branch adapter refuses another tenant and inactive branches under RLS', async () => {
  const db = createDatabase({ url: h.urls.app, ids: { newId: () => company } });
  try {
    const reader = createAttendanceBranchReader(db);
    expect(await reader.read('01920000-0000-7000-8000-000000000099', branch)).toBeNull();
    await h.owner`UPDATE branches SET is_active = false WHERE company_id = ${company} AND id = ${branch}`;
    expect(await reader.read(company, branch)).toBeNull();
    const res = await issue();
    expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([404, 'NOT_FOUND']);
  } finally {
    await h.owner`UPDATE branches SET is_active = true WHERE company_id = ${company} AND id = ${branch}`;
    await db.close();
  }
});

it('revocation blocks the next QR refresh', async () => {
  await h.send('POST', `/v1/branches/${branch}/devices/${deviceId}/revoke`, {
    cookie: owner,
    company,
  });
  expect((await issue()).statusCode).toBe(401);
});
