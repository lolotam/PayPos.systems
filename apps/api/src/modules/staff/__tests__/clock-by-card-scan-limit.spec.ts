import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { deriveEmployeeCardKey } from '@pospay/auth';
import { errorEnvelope } from '@pospay/contracts';
import { errorMessages } from '@pospay/i18n';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { createEmployeeCardHash } from '../persistence/employee-card-hash.ts';
import {
  CARD_SCAN_FAILURES_PER_WINDOW,
  CARD_SCAN_WINDOW_SECONDS,
} from '../persistence/card-scan-attempts.ts';

const STAFF_ORIGIN = 'http://localhost:5173';
const CARD = 'CARD-LIMIT-1';
const URL = '/v1/devices/me/clock-by-card';
const hash = createEmployeeCardHash(
  deriveEmployeeCardKey('test-secret-that-is-long-enough-for-hmac'),
);

let h: Harness;
let logs = '';
let company: string;
let owner: string;
let deviceA = '';
let deviceB = '';
let tokenA = '';
let tokenB = '';
let cookieA = '';
let cookieB = '';

const send = (options: { authorization: string; cookie: string; key: string; code?: string }) =>
  h.app.inject({
    method: 'POST',
    url: URL,
    headers: {
      origin: STAFF_ORIGIN,
      authorization: options.authorization,
      cookie: options.cookie,
      'idempotency-key': options.key,
    },
    payload: { card_code: options.code ?? CARD },
  });

beforeAll(async () => {
  h = await startHarness({
    staffOrigin: STAFF_ORIGIN,
    logs: new Writable({
      write(chunk, _encoding, done) {
        logs += String(chunk);
        done();
      },
    }),
  });
  await seed();
});

afterAll(async () => {
  await h?.close();
});

async function seed(): Promise<void> {
  owner = await h.signedInOperator('clock-limit@example.test');
  company = await h.onboard(owner, 'Clock Limit Co');
  const business = await createBusiness();
  const branch = await createBranch(business);
  const employee = randomUUID();
  const operatorA = await addOperator('card-limit-a@example.test', branch);
  const operatorB = await addOperator('card-limit-b@example.test', branch);
  await h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date)
    VALUES(${company},${employee},${business},${branch},'Synthetic limit employee','staff','2026-01-01')`;
  await h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${company},${randomUUID()},${business},${employee},${branch},'2026-01-01')`;
  await h.owner`INSERT INTO employee_cards(company_id,id,business_id,employee_id,card_code_hash,card_code_suffix,issued_at,issued_by)
    VALUES(${company},${randomUUID()},${business},${employee},${hash(company, CARD)},'MT-1',clock_timestamp(),${operatorA})`;
  ({ deviceId: deviceA, token: tokenA } = await pair(branch, 'Synthetic limit till'));
  ({ deviceId: deviceB, token: tokenB } = await pair(branch, 'Synthetic other till'));
  cookieA = await session(operatorA, deviceA, business, branch);
  cookieB = await session(operatorB, deviceB, business, branch);
}

async function createBusiness(): Promise<string> {
  const created = await h.send('POST', '/v1/businesses', {
    cookie: owner,
    company,
    key: 'limit-business',
    body: { vertical_type: 'salon', name_en: 'Limit salon', timezone: 'Asia/Kuwait' },
  });
  return String(created.body['id']);
}

async function createBranch(business: string): Promise<string> {
  const branch = await h.send('POST', `/v1/businesses/${business}/branches`, {
    cookie: owner,
    company,
    key: 'limit-branch',
    body: { name_en: 'Limit reception' },
  });
  return String(branch.body['id']);
}

async function pair(branch: string, label: string) {
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
  const claim = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    payload: registered,
  });
  return {
    deviceId: registered.device_id,
    token: (claim.json() as { device_token: string }).device_token,
  };
}

async function addOperator(email: string, branch: string): Promise<string> {
  const userId = randomUUID();
  const digits = (BigInt(`0x${userId.replaceAll('-', '').slice(0, 12)}`) % 100000000n)
    .toString()
    .padStart(8, '0');
  await h.owner`INSERT INTO "user"(id,name,email,phone_number,phone_binding_approved_at)
    VALUES(${userId},'Synthetic limit operator',${email},${`+965${digits}`},clock_timestamp() - interval '1 day')`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${company},${randomUUID()},${userId},id,'global','BRANCH',${branch},clock_timestamp() - interval '1 day'
    FROM roles WHERE code='cashier' AND company_id IS NULL`;
  return userId;
}

async function session(
  userId: string,
  deviceId: string,
  business: string,
  branch: string,
): Promise<string> {
  const issued = await h.auth.staff.issue(
    userId,
    { companyId: company, businessId: business, branchId: branch, deviceId },
    async () => true,
  );
  return issued.cookie.split(';')[0] ?? '';
}

async function resetScans(deviceId: string): Promise<void> {
  const prefix = h.redis.options.keyPrefix ?? '';
  if (!prefix.startsWith('test:')) throw new Error('SYNTHETIC_REDIS_SCOPE_REQUIRED');
  const keys = await h.redis.keys(`${prefix}rate:*card-scan:${company}:${deviceId}*`);
  if (keys.length !== 0) await h.redis.del(...keys.map((key) => key.slice(prefix.length)));
}

async function rejectUnknown(token: string, cookie: string, code: string): Promise<void> {
  const response = await send({
    authorization: `Device ${token}`,
    cookie,
    key: randomUUID(),
    code,
  });
  expect([response.statusCode, errorEnvelope.parse(response.json()).code]).toEqual([
    404,
    'NOT_FOUND',
  ]);
}

async function burn(token: string, cookie: string): Promise<void> {
  for (let n = 0; n < CARD_SCAN_FAILURES_PER_WINDOW; n += 1) {
    await rejectUnknown(token, cookie, `MISS-${String(n).padStart(4, '0')}`);
  }
}

async function attendanceEffects() {
  const data: unknown[] = [];
  for (const table of [
    'attendance_sessions',
    'attendance_states',
    'attendance_exceptions',
    'audit_log',
    'outbox',
    'idempotency_keys',
  ]) {
    const order = table === 'idempotency_keys' ? 'scope_type,scope_id,operation,key' : 'id';
    data.push(
      await h.owner.unsafe(`SELECT * FROM ${table} WHERE company_id=$1 ORDER BY ${order}`, [
        company,
      ]),
    );
  }
  return data;
}

async function expectBlocked(token: string, cookie: string, deviceId: string, code: string) {
  const from = logs.length;
  const start = h.calls.statements.length;
  const before = await attendanceEffects();
  const response = await send({
    authorization: `Device ${token}`,
    cookie,
    key: randomUUID(),
    code,
  });
  const sqlText = h.calls.statements
    .slice(start)
    .map((statement) => statement.sql)
    .join('\n');
  expect(response.statusCode).toBe(429);
  expect(response.json()).toMatchObject({
    code: 'TOO_MANY_REQUESTS',
    ...errorMessages('TOO_MANY_REQUESTS'),
  });
  const ttl = await h.redis.ttl(`rate:card-scan:${company}:${deviceId}`);
  const header = Number(response.headers['retry-after']);
  expect(header).toBeGreaterThan(0);
  expect(header).toBeLessThanOrEqual(CARD_SCAN_WINDOW_SECONDS);
  expect(Math.abs(header - ttl)).toBeLessThanOrEqual(2);
  expect(sqlText).not.toContain('employee_cards');
  expect(sqlText).not.toContain('INSERT INTO');
  expect(sqlText).not.toContain('UPDATE idempotency_keys');
  expect(sqlText).not.toContain('audit_log');
  expect(sqlText).not.toContain('attendance_sessions');
  expect(sqlText).not.toContain('outbox');
  expect(await attendanceEffects()).toEqual(before);
  const line = logs.slice(from);
  expect(line).toContain('card scan limited');
  expect(line).not.toContain(code);
}

it('rejects the 11th failed scan in the window and writes nothing', async () => {
  expect(CARD_SCAN_FAILURES_PER_WINDOW).toBe(10);
  expect(CARD_SCAN_WINDOW_SECONDS).toBe(600);
  await resetScans(deviceA);
  await burn(tokenA, cookieA);
  await expectBlocked(tokenA, cookieA, deviceA, 'NOT-REAL-CARD');
});

it('does not count a successful scan', async () => {
  await resetScans(deviceA);
  const clocked = await send({
    authorization: `Device ${tokenA}`,
    cookie: cookieA,
    key: randomUUID(),
  });
  expect(clocked.statusCode).toBe(200);
  await burn(tokenA, cookieA);
});

it('does not count a replay of a completed key', async () => {
  await resetScans(deviceA);
  const key = randomUUID();
  const first = await send({ authorization: `Device ${tokenA}`, cookie: cookieA, key });
  expect(first.statusCode).toBe(200);
  const replay = await send({ authorization: `Device ${tokenA}`, cookie: cookieA, key });
  expect(replay.statusCode).toBe(200);
  expect(replay.json()).toEqual(first.json());
  await burn(tokenA, cookieA);
  const again = await send({ authorization: `Device ${tokenA}`, cookie: cookieA, key });
  expect(again.statusCode).toBe(200);
  expect(again.json()).toEqual(first.json());
  await expectBlocked(tokenA, cookieA, deviceA, 'NOT-REAL-CARD');
});

it('counts another device separately', async () => {
  await resetScans(deviceA);
  await resetScans(deviceB);
  await burn(tokenA, cookieA);
  await expectBlocked(tokenA, cookieA, deviceA, 'NOT-REAL-CARD');
  const other = await send({
    authorization: `Device ${tokenB}`,
    cookie: cookieB,
    key: randomUUID(),
  });
  expect(other.statusCode).toBe(200);
});

it('returns the movement when the completion marker cannot be stored', async () => {
  await resetScans(deviceA);
  const key = randomUUID();
  await whenScanMarkerFails(async () => {
    const from = logs.length;
    const before = await attendanceEffects();
    const first = await send({ authorization: `Device ${tokenA}`, cookie: cookieA, key });
    expect(first.statusCode).toBe(200);
    const issued = await attendanceEffects();
    expect(issued).not.toEqual(before);
    const warned = logs.slice(from);
    expect(occurrences(warned, 'card scan completion unrecorded')).toBe(1);
    expect(occurrences(warned, 'card scan redis unavailable')).toBe(1);
    expect(warned).not.toContain(CARD);
    const replay = await send({ authorization: `Device ${tokenA}`, cookie: cookieA, key });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(await attendanceEffects()).toEqual(issued);
    expect(occurrences(logs.slice(from), 'card scan completion unrecorded')).toBe(1);
  });
});

it('replays the stored scan at the limit when the marker is missing', async () => {
  await resetScans(deviceA);
  const key = randomUUID();
  await whenScanMarkerFails(async () => {
    const first = await send({ authorization: `Device ${tokenA}`, cookie: cookieA, key });
    expect(first.statusCode).toBe(200);
    await burn(tokenA, cookieA);
    const issued = await attendanceEffects();
    const replay = await send({ authorization: `Device ${tokenA}`, cookie: cookieA, key });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(await attendanceEffects()).toEqual(issued);
    const changed = await send({
      authorization: `Device ${tokenA}`,
      cookie: cookieA,
      key,
      code: 'OTHER-CARD-99',
    });
    expect(changed.statusCode).toBe(429);
    expect(await attendanceEffects()).toEqual(issued);
    await expectBlocked(tokenA, cookieA, deviceA, 'NOT-REAL-CARD');
  });
});

it('fails a scan closed when redis is unavailable', async () => {
  const before = await attendanceEffects();
  const start = h.calls.statements.length;
  h.redis.options.enableOfflineQueue = false;
  h.redis.options.maxRetriesPerRequest = 0;
  h.redis.disconnect();
  try {
    const response = await send({
      authorization: `Device ${tokenA}`,
      cookie: cookieA,
      key: randomUUID(),
      code: 'NOT-REAL-CARD',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'NOT_READY', ...errorMessages('NOT_READY') });
    expect(
      h.calls.statements
        .slice(start)
        .map((statement) => statement.sql)
        .join('\n'),
    ).not.toContain('employee_cards');
    expect(await attendanceEffects()).toEqual(before);
  } finally {
    await h.redis.connect();
  }
});

/** أول حفظ لعلامة اكتمال المسح يفشل مرة واحدة، ثم Redis يرجع لسلوكه. */
async function whenScanMarkerFails<T>(run: () => Promise<T>): Promise<T> {
  const redis = h.redis;
  const original = redis.set;
  let failed = false;
  redis.set = function patched(this: typeof redis, ...args: unknown[]) {
    const name = String(args[0]);
    if (!failed && name.includes('rate:done:card-scan:')) {
      failed = true;
      return Promise.reject(new Error('redis down'));
    }
    return original.apply(this, args as never);
  } as typeof redis.set;
  try {
    return await run();
  } finally {
    redis.set = original;
  }
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
