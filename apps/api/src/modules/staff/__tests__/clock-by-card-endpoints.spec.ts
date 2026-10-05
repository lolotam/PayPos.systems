import { randomUUID } from 'node:crypto';
import { clockAttendanceResult, errorEnvelope } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

const STAFF_ORIGIN = 'http://localhost:5173';
const CARD_CODE = 'CARD-HTTP-1';
const URL = '/v1/devices/me/clock-by-card';

let h: Harness;
let company: string;
let business: string;
let branch: string;
let employee: string;
let operatorId: string;
let cardId: string;
let deviceToken: string;
let viewerDeviceToken: string;
let staffCookie: string;
let viewerCookie: string;

async function pair(label: string) {
  const code = await h.send('POST', `/v1/branches/${branch}/devices/pairing-code`, {
    cookie: owner,
    company,
  });
  const registration = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: code.body['code'], label },
  });
  const registered = registration.json() as {
    device_id: string;
    company_id: string;
    claim_secret: string;
  };
  await h.send('POST', `/v1/branches/${branch}/devices/${registered.device_id}/approve`, {
    cookie: owner,
    company,
  });
  const claim = await h.app.inject({ method: 'POST', url: '/v1/devices/claim', payload: registered });
  return { deviceId: registered.device_id, token: (claim.json() as { device_token: string }).device_token };
}

let owner: string;

async function addOperator(email: string, roleCode: string): Promise<string> {
  const userId = randomUUID();
  await bindUser(userId, email);
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${company},${randomUUID()},${userId},id,'global','BRANCH',${branch},clock_timestamp() - interval '1 day'
    FROM roles WHERE code=${roleCode} AND company_id IS NULL`;
  return userId;
}

async function addReceptionOperator(email: string): Promise<string> {
  const userId = randomUUID();
  const roleId = randomUUID();
  await bindUser(userId, email);
  await h.owner`INSERT INTO roles(id,company_id,code,name_en) VALUES(${roleId},${company},'reception_card','Reception card')`;
  await h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
    VALUES(${roleId},${company},${company},'login:staff:branch'),(${roleId},${company},${company},'clock:attendance:branch')`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES(${company},${randomUUID()},${userId},${roleId},${company},'BRANCH',${branch},clock_timestamp() - interval '1 day')`;
  return userId;
}

// جلسة الوردية تشترط ربط هاتف معتمداً سابقاً لوقت الإصدار؛ بيانات اصطناعية فقط.
async function bindUser(userId: string, email: string): Promise<void> {
  const digits = (BigInt(`0x${userId.replaceAll('-', '').slice(0, 12)}`) % 100000000n)
    .toString()
    .padStart(8, '0');
  const phone = `+965${digits}`;
  await h.owner`INSERT INTO "user"(id,name,email,phone_number,phone_binding_approved_at)
    VALUES(${userId},'Synthetic card operator',${email},${phone},clock_timestamp() - interval '1 day')`;
}

async function session(userId: string, deviceId: string): Promise<string> {
  const issued = await h.auth.staff.issue(
    userId,
    { companyId: company, businessId: business, branchId: branch, deviceId },
    async () => true,
  );
  return issued.cookie.split(';')[0] ?? '';
}

const send = (options: { authorization?: string; cookie?: string; key?: string; code?: string }) =>
  h.app.inject({
    method: 'POST',
    url: URL,
    headers: {
      origin: STAFF_ORIGIN,
      ...(options.authorization === undefined ? {} : { authorization: options.authorization }),
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(options.key === undefined ? {} : { 'idempotency-key': options.key }),
    },
    payload: { card_code: options.code ?? CARD_CODE },
  });

beforeAll(async () => {
  h = await startHarness({ staffOrigin: STAFF_ORIGIN });
  owner = await h.signedInOperator('clock-card@example.test');
  company = await h.onboard(owner, 'Clock Card Co');
  const created = await h.send('POST', '/v1/businesses', {
    cookie: owner,
    company,
    key: 'card-business',
    body: { vertical_type: 'salon', name_en: 'Card salon', timezone: 'Asia/Kuwait' },
  });
  business = String(created.body['id']);
  const branchRes = await h.send('POST', `/v1/businesses/${business}/branches`, {
    cookie: owner,
    company,
    key: 'card-branch',
    body: { name_en: 'Card reception' },
  });
  branch = String(branchRes.body['id']);
  employee = randomUUID();
  await h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date)
    VALUES(${company},${employee},${business},${branch},'Synthetic card employee','staff','2026-01-01')`;
  await h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${company},${randomUUID()},${business},${employee},${branch},'2026-01-01')`;
  operatorId = await addReceptionOperator('card-reception@example.test');
  const viewerId = await addOperator('card-ownerless@example.test', 'staff');
  const receptionDevice = await pair('Synthetic card till');
  const viewerDevice = await pair('Synthetic viewer till');
  deviceToken = receptionDevice.token;
  viewerDeviceToken = viewerDevice.token;
  cardId = randomUUID();
  await h.owner`INSERT INTO employee_cards(company_id,id,business_id,employee_id,card_code,issued_at,issued_by)
    VALUES(${company},${cardId},${business},${employee},${CARD_CODE},clock_timestamp(),${operatorId})`;
  // جلسة وردية واحدة لكل جهاز، فهما جهازان مختلفان لعاملين مختلفين.
  staffCookie = await session(operatorId, receptionDevice.deviceId);
  viewerCookie = await session(viewerId, viewerDevice.deviceId);
});

afterAll(async () => {
  await h?.close();
});

it('clocks by card on the paired device with a signed-in permitted operator', async () => {
  const response = await send({
    authorization: `Device ${deviceToken}`,
    cookie: staffCookie,
    key: randomUUID(),
  });
  expect(response.statusCode).toBe(200);
  expect(clockAttendanceResult.parse(response.json())).toMatchObject({ operation: 'CLOCK_IN' });
  expect(response.headers['cache-control']).toBe('no-store');
});

it('refuses a non-Device session and a device operator without the permission', async () => {
  const browser = await send({ cookie: owner, key: randomUUID() });
  expect(browser.statusCode).toBe(401);
  const withoutPermission = await send({
    authorization: `Device ${viewerDeviceToken}`,
    cookie: viewerCookie,
    key: randomUUID(),
  });
  expect([withoutPermission.statusCode, errorEnvelope.parse(withoutPermission.json()).code]).toEqual([
    403, 'FORBIDDEN',
  ]);
});

it('requires an Idempotency-Key and answers an unknown card like a revoked one', async () => {
  const missing = await send({ authorization: `Device ${deviceToken}`, cookie: staffCookie });
  expect([missing.statusCode, errorEnvelope.parse(missing.json()).code]).toEqual([
    400, 'IDEMPOTENCY_KEY_REQUIRED',
  ]);
  await h.owner`UPDATE employee_cards SET revoked_at=clock_timestamp(),revoked_by=${operatorId} WHERE company_id=${company} AND id=${cardId}`;
  const revoked = await send({ authorization: `Device ${deviceToken}`, cookie: staffCookie, key: randomUUID() });
  expect([revoked.statusCode, errorEnvelope.parse(revoked.json()).code]).toEqual([404, 'NOT_FOUND']);
  const unknown = await send({
    authorization: `Device ${deviceToken}`,
    cookie: staffCookie,
    key: randomUUID(),
    code: 'UNKNOWN-HTTP',
  });
  expect([unknown.statusCode, errorEnvelope.parse(unknown.json()).code]).toEqual([404, 'NOT_FOUND']);
});
