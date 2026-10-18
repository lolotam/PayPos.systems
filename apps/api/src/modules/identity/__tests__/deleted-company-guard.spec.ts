import { errorEnvelope } from '@pospay/contracts';
import { createDatabase, type Database } from '@pospay/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { seedEmployee } from '../../../../../../packages/db/test/staff-fixtures.ts';
import { CASHIER_PIN_USE_CASES, type CashierPinUseCases } from '../http/cashier-pins.controller.ts';
import { createAccessReader, readAccessTransaction } from '../persistence/access-reader.ts';
import { readFeatureEnabled } from '../persistence/feature-reader.ts';
import { AuthorizeRequest } from '../use-cases/authorize-request/authorize-request.ts';

const EMAIL = 'deleted-guard@example.test';
const PIN = '7391';
const EMPLOYEE = '01920000-0000-7000-8000-0000000000e1';

let h: Harness;
let db: Database;
let cookie: string;
let userId: string;
let activeCompany: string;
let deletedCompany: string;
let activeBusiness: string;
let deletedBusiness: string;
let deletedBranch: string;
let deviceToken: string;
let pendingClaim: { company_id: string; device_id: string; claim_secret: string };
let unusedCode: string;

async function businessIn(company: string, key: string): Promise<string> {
  const created = await h.send('POST', '/v1/businesses', {
    cookie,
    company,
    key: `${key}-business`,
    body: { vertical_type: 'salon', name_en: key },
  });
  expect(created.status).toBe(201);
  return created.body['id'] as string;
}

async function branchIn(company: string, business: string, key: string): Promise<string> {
  const created = await h.send('POST', `/v1/businesses/${business}/branches`, {
    cookie,
    company,
    key: `${key}-branch`,
    body: { name_en: key },
  });
  expect(created.status).toBe(201);
  return created.body['id'] as string;
}

async function pairingCode(branch: string): Promise<string> {
  const res = await h.send('POST', `/v1/branches/${branch}/devices/pairing-code`, {
    cookie,
    company: deletedCompany,
  });
  expect(res.status).toBe(201);
  return res.body['code'] as string;
}

async function registered(branch: string, label: string) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: await pairingCode(branch), label },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { company_id: string; device_id: string; claim_secret: string };
}

async function approvedDevice(branch: string): Promise<string> {
  const device = await registered(branch, 'Open till');
  const approved = await h.send(
    'POST',
    `/v1/branches/${branch}/devices/${device.device_id}/approve`,
    { cookie, company: deletedCompany },
  );
  expect(approved.status).toBe(204);
  const claimed = await h.app.inject({ method: 'POST', url: '/v1/devices/claim', payload: device });
  expect(claimed.statusCode).toBe(200);
  return (claimed.json() as { device_token: string }).device_token;
}

function verifyPin(employeeId: string, pin: string) {
  return h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/cashier-pin/verify',
    headers: { authorization: `Device ${deviceToken}` },
    payload: { employee_id: employeeId, pin },
  });
}

async function armDeletedCompany(): Promise<void> {
  deletedBusiness = await businessIn(deletedCompany, 'deleted-guard');
  deletedBranch = await branchIn(deletedCompany, deletedBusiness, 'deleted-guard');
  deviceToken = await approvedDevice(deletedBranch);
  await seedEmployee(h.owner, deletedCompany, EMPLOYEE);
  await h.app.get<CashierPinUseCases>(CASHIER_PIN_USE_CASES).setCashierPin.execute({
    companyId: deletedCompany,
    userId,
    employeeId: EMPLOYEE,
    pin: PIN,
  });
  expect((await verifyPin(EMPLOYEE, PIN)).statusCode).toBe(200);
  pendingClaim = await registered(deletedBranch, 'Unclaimed till');
  const approved = await h.send(
    'POST',
    `/v1/branches/${deletedBranch}/devices/${pendingClaim.device_id}/approve`,
    { cookie, company: deletedCompany },
  );
  expect(approved.status).toBe(204);
  unusedCode = await pairingCode(deletedBranch);
  await h.owner`INSERT INTO company_feature_overrides (company_id, flag, enabled, reason, set_by)
    VALUES (${deletedCompany}, 'orders', true, 'synthetic', ${userId})`;
  await h.owner`UPDATE companies SET deleted_at=now() WHERE id=${deletedCompany}`;
}

beforeAll(async () => {
  h = await startHarness();
  db = createDatabase({ url: h.urls.app, ids: { newId: randomUUID } });
  cookie = await h.signedInOperator(EMAIL);
  const [user] = await h.owner`SELECT id FROM "user" WHERE email=${EMAIL}`;
  userId = user?.['id'] as string;
  activeCompany = await h.onboard(cookie, 'Active Guard Co');
  deletedCompany = await h.onboard(cookie, 'Deleted Guard Co');
  activeBusiness = await businessIn(activeCompany, 'active-guard');
  await armDeletedCompany();
});

afterAll(async () => {
  await db?.close();
  await h?.close();
});

function refused(status: number, body: Record<string, unknown>) {
  return [status, errorEnvelope.parse(body).code] as const;
}

it('returns no grants for a soft-deleted company and leaves an active company readable', async () => {
  const deleted = await db.withTenant(
    deletedCompany,
    (tx) => readAccessTransaction(tx, deletedCompany, userId),
    { userId },
  );
  const active = await db.withTenant(
    activeCompany,
    (tx) => readAccessTransaction(tx, activeCompany, userId),
    { userId },
  );
  expect(deleted).toEqual({ memberships: [], grants: [] });
  expect(active.memberships.length).toBeGreaterThan(0);
  expect(active.grants.length).toBeGreaterThan(0);
  expect(
    await db.withTenant(deletedCompany, (tx) => readFeatureEnabled(tx, deletedCompany, 'orders'), {
      userId,
    }),
  ).toBe(false);
  expect(
    await db.withTenant(activeCompany, (tx) => readFeatureEnabled(tx, activeCompany, 'orders'), {
      userId,
    }),
  ).toBe(true);
  const companies = await createAccessReader(db).companiesOf(userId);
  expect(companies).toContain(deletedCompany);
  expect(companies).toContain(activeCompany);
});

it('refuses the member through the existing permission check on both guard paths', async () => {
  const authorize = h.app.get(AuthorizeRequest);
  expect(
    await authorize.execute({
      userId,
      requestedCompany: deletedCompany,
      permission: 'read:settings:business',
      businessParam: deletedBusiness,
    }),
  ).toBeNull();
  expect(
    await authorize.execute({
      userId,
      requestedCompany: activeCompany,
      permission: 'read:settings:business',
      businessParam: activeBusiness,
    }),
  ).not.toBeNull();
  const branches = await authorize.executeBranches({
    userId,
    requestedCompany: deletedCompany,
    permission: 'read:service-sessions:branch',
    branchParams: [deletedBranch],
  });
  expect(branches.get(deletedBranch)).toBe(false);
});

it('refuses a guarded settings read and write with FORBIDDEN and still reads the active company', async () => {
  const deletedRead = await h.send('GET', `/v1/businesses/${deletedBusiness}/settings`, {
    cookie,
    company: deletedCompany,
  });
  const deletedWrite = await h.send('PATCH', `/v1/businesses/${deletedBusiness}/settings`, {
    cookie,
    company: deletedCompany,
    body: { calendar: 'hijri' },
  });
  const activeRead = await h.send('GET', `/v1/businesses/${activeBusiness}/settings`, {
    cookie,
    company: activeCompany,
  });
  expect(refused(deletedRead.status, deletedRead.body)).toEqual([403, 'FORBIDDEN']);
  expect(refused(deletedWrite.status, deletedWrite.body)).toEqual([403, 'FORBIDDEN']);
  expect(activeRead.status).toBe(200);
  expect(activeRead.body).toMatchObject({ business_id: activeBusiness, calendar: 'gregorian' });
});

it('refuses one staff read and one orders read for the soft-deleted company', async () => {
  const staff = await h.send('GET', `/v1/businesses/${deletedBusiness}/employees`, {
    cookie,
    company: deletedCompany,
  });
  const orders = await h.send(
    'GET',
    `/v1/businesses/${deletedBusiness}/branches/${deletedBranch}/service-sessions?date=2026-10-19`,
    { cookie, company: deletedCompany },
  );
  expect(refused(staff.status, staff.body)).toEqual([403, 'FORBIDDEN']);
  expect(refused(orders.status, orders.body)).toEqual([403, 'FORBIDDEN']);
});

it('refuses a new device registration, an unclaimed token and a cashier PIN on the deleted company', async () => {
  const registeredAfter = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: unusedCode, label: 'Late till' },
  });
  const claimed = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    payload: pendingClaim,
  });
  const pin = await verifyPin(EMPLOYEE, PIN);
  expect([registeredAfter.statusCode, errorEnvelope.parse(registeredAfter.json()).code]).toEqual([
    400,
    'PAIRING_CODE_INVALID',
  ]);
  expect([claimed.statusCode, errorEnvelope.parse(claimed.json()).code]).toEqual([
    401,
    'UNAUTHENTICATED',
  ]);
  expect([pin.statusCode, errorEnvelope.parse(pin.json()).code]).toEqual([401, 'PIN_INVALID']);
  const devices =
    await h.owner`SELECT id FROM devices WHERE company_id=${deletedCompany} AND label='Late till'`;
  expect(devices).toEqual([]);
});
