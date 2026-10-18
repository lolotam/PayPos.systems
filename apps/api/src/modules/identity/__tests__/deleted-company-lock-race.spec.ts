import { errorEnvelope } from '@pospay/contracts';
import { createDatabase, type Database } from '@pospay/db';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { seedEmployee } from '../../../../../../packages/db/test/staff-fixtures.ts';
import { CASHIER_PIN_USE_CASES, type CashierPinUseCases } from '../http/cashier-pins.controller.ts';
import { readAccessTransaction } from '../persistence/access-reader.ts';
import { lockEmployeeNumberAccess } from '../persistence/employee-number-access.ts';

const EMAIL = 'deleted-lock-race@example.test';
const PIN = '7391';
const EMPLOYEE = '01920000-0000-7000-8000-0000000000e1';
const RACE_LABEL = 'Race till';

let h: Harness;
let db: Database;
let cookie: string;
let userId: string;
let company: string;
let branch: string;
let deviceToken: string;
let pendingClaim: { company_id: string; device_id: string; claim_secret: string };

function barrier(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function untilShareWait(observer: ReturnType<typeof postgres>): Promise<void> {
  await vi.waitFor(
    async () => {
      const waiting = await observer`SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE '%companies%deleted_at IS NULL FOR SHARE%'
          AND pid<>pg_backend_pid()`;
      expect(waiting.length).toBeGreaterThan(0);
    },
    { timeout: 5_000, interval: 20 },
  );
}

async function duringDeletion<T>(start: () => Promise<T>): Promise<T> {
  const locked = barrier();
  const release = barrier();
  const deletion = h.owner.begin(async (tx) => {
    await tx`UPDATE companies SET deleted_at=now() WHERE id=${company}`;
    locked.release();
    await release.promise;
  });
  await locked.promise;
  const subject = start();
  const observer = postgres(h.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await untilShareWait(observer);
  } finally {
    release.release();
    try {
      await deletion;
    } finally {
      await observer.end();
    }
  }
  return subject;
}

async function createdId(url: string, key: string, body: object): Promise<string> {
  const created = await h.send('POST', url, { cookie, company, key, body });
  expect(created.status).toBe(201);
  return created.body['id'] as string;
}

async function pairingCode(): Promise<string> {
  const res = await h.send('POST', `/v1/branches/${branch}/devices/pairing-code`, { cookie, company });
  expect(res.status).toBe(201);
  return res.body['code'] as string;
}

async function registered(label: string) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: await pairingCode(), label },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { company_id: string; device_id: string; claim_secret: string };
}

async function approve(deviceId: string): Promise<void> {
  const approved = await h.send('POST', `/v1/branches/${branch}/devices/${deviceId}/approve`, {
    cookie,
    company,
  });
  expect(approved.status).toBe(204);
}

function outcome(res: { statusCode: number; json: () => unknown }) {
  return [res.statusCode, errorEnvelope.parse(res.json()).code] as const;
}

beforeAll(async () => {
  h = await startHarness();
  db = createDatabase({ url: h.urls.app, ids: { newId: randomUUID } });
  cookie = await h.signedInOperator(EMAIL);
  const [user] = await h.owner`SELECT id FROM "user" WHERE email=${EMAIL}`;
  userId = user?.['id'] as string;
  company = await h.onboard(cookie, 'Lock Race Co');
  const business = await createdId('/v1/businesses', 'lock-race-business', {
    vertical_type: 'salon',
    name_en: 'Lock Race',
  });
  branch = await createdId(`/v1/businesses/${business}/branches`, 'lock-race-branch', {
    name_en: 'Lock Race',
  });
  const approved = await registered('Open till');
  await approve(approved.device_id);
  const claimed = await h.app.inject({ method: 'POST', url: '/v1/devices/claim', payload: approved });
  expect(claimed.statusCode).toBe(200);
  deviceToken = (claimed.json() as { device_token: string }).device_token;
  pendingClaim = await registered('Unclaimed till');
  await approve(pendingClaim.device_id);
  await seedEmployee(h.owner, company, EMPLOYEE);
  await h.app.get<CashierPinUseCases>(CASHIER_PIN_USE_CASES).setCashierPin.execute({
    companyId: company,
    userId,
    employeeId: EMPLOYEE,
    pin: PIN,
  });
});

beforeEach(async () => {
  await h.owner`UPDATE companies SET deleted_at=NULL WHERE id=${company}`;
});

afterAll(async () => {
  await db?.close();
  await h?.close();
});

it('waits on the company share lock and then returns no access after the deletion commits', async () => {
  const access = await duringDeletion(() =>
    db.withTenant(company, (tx) => readAccessTransaction(tx, company, userId), { userId }),
  );
  expect(access).toEqual({ memberships: [], grants: [] });
});

it('waits on registration and then refuses without inserting the device', async () => {
  const code = await pairingCode();
  const registeredAfter = await duringDeletion(() =>
    h.app.inject({
      method: 'POST',
      url: '/v1/devices/register',
      payload: { pairing_code: code, label: RACE_LABEL },
    }),
  );
  expect(outcome(registeredAfter)).toEqual([400, 'PAIRING_CODE_INVALID']);
  expect(
    await h.owner`SELECT id FROM devices WHERE company_id=${company} AND label=${RACE_LABEL}`,
  ).toEqual([]);
});

it('waits on token claim and then refuses without clearing the claim secret', async () => {
  const [before] = await h.owner<{ claim_hash: string }[]>`
    SELECT claim_hash FROM devices WHERE company_id=${company} AND id=${pendingClaim.device_id}`;
  const claimed = await duringDeletion(() =>
    h.app.inject({ method: 'POST', url: '/v1/devices/claim', payload: pendingClaim }),
  );
  const [after] = await h.owner<{ claim_hash: string; token_hash: string | null }[]>`
    SELECT claim_hash, token_hash FROM devices WHERE company_id=${company} AND id=${pendingClaim.device_id}`;
  expect(outcome(claimed)).toEqual([401, 'UNAUTHENTICATED']);
  expect(after).toEqual({ claim_hash: before?.claim_hash, token_hash: null });
});

it('waits on PIN verification and then refuses without reserving an attempt', async () => {
  const pin = await duringDeletion(() =>
    h.app.inject({
      method: 'POST',
      url: '/v1/devices/me/cashier-pin/verify',
      headers: { authorization: `Device ${deviceToken}` },
      payload: { employee_id: EMPLOYEE, pin: PIN },
    }),
  );
  expect(outcome(pin)).toEqual([401, 'PIN_INVALID']);
  expect(
    await h.redis.exists(
      `pin:${company}:${EMPLOYEE}:failures`,
      `pin:${company}:${EMPLOYEE}:reservations`,
      `pin:${company}:${EMPLOYEE}:lock`,
    ),
  ).toBe(0);
});

it('reads grants after a stronger company lock in the same transaction', async () => {
  const access = await db.withTenant(
    company,
    async (tx) => {
      expect(await lockEmployeeNumberAccess(tx, company)).toBe(true);
      return readAccessTransaction(tx, company, userId);
    },
    { userId },
  );
  expect(access.memberships.length).toBeGreaterThan(0);
  expect(access.grants.length).toBeGreaterThan(0);
});
