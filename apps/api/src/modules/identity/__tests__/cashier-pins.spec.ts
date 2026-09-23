import { Writable } from 'node:stream';

import { errorEnvelope } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { CASHIER_PIN_USE_CASES, type CashierPinUseCases } from '../http/cashier-pins.controller.ts';
import { createRedisPinAttempts } from '../persistence/redis-pin-attempts.ts';
import type { PinAttempts } from '../ports/cashier-pins.port.ts';
import { CashierPinMalformedError } from '../use-cases/set-cashier-pin/set-cashier-pin.ts';

// T9b-3 through the API with real Postgres and Redis: a manager sets an employee's PIN (only its hash is stored), an
// approved device verifies it, the fifth wrong PIN locks it for 15 minutes (D-08), and the PIN never reaches a log.
const PIN = '7391';
const EMPLOYEE = '01920000-0000-7000-8000-0000000000f1';
const OTHER_EMPLOYEE = '01920000-0000-7000-8000-0000000000f2';
let h: Harness;
let pins: CashierPinUseCases;
let owner: string;
let managerId: string;
let company: string;
let otherCompany: string;
let deviceToken: string;
const logText: string[] = [];

async function branchIn(companyId: string, key: string): Promise<string> {
  const business = await h.send('POST', '/v1/businesses', {
    cookie: owner,
    company: companyId,
    key: `${key}-business`,
    body: { vertical_type: 'retail', name_en: 'Shop' },
  });
  const branch = await h.send('POST', `/v1/businesses/${business.body['id'] as string}/branches`, {
    cookie: owner,
    company: companyId,
    key: `${key}-branch`,
    body: { name_en: key },
  });
  return branch.body['id'] as string;
}

async function approvedDevice(companyId: string, branch: string): Promise<string> {
  const code = await h.send('POST', `/v1/branches/${branch}/devices/pairing-code`, {
    cookie: owner,
    company: companyId,
  });
  const registered = (
    await h.app.inject({
      method: 'POST',
      url: '/v1/devices/register',
      payload: { pairing_code: code.body['code'], label: 'PIN till' },
    })
  ).json() as { company_id: string; device_id: string; claim_secret: string };
  await h.send('POST', `/v1/branches/${branch}/devices/${registered.device_id}/approve`, {
    cookie: owner,
    company: companyId,
  });
  const claimed = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    payload: registered,
  });
  return (claimed.json() as { device_token: string }).device_token;
}

beforeAll(async () => {
  const logs = new Writable({
    write(chunk, _encoding, done) {
      logText.push(String(chunk));
      done();
    },
  });
  h = await startHarness({ logs });
  pins = h.app.get<CashierPinUseCases>(CASHIER_PIN_USE_CASES);
  owner = await h.signedInOperator('pins-owner@example.test');
  const [row] = await h.owner`SELECT id FROM "user" WHERE email = 'pins-owner@example.test'`;
  managerId = row?.['id'] as string;
  company = await h.onboard(owner, 'Pins Co');
  otherCompany = await h.onboard(owner, 'Other Pins Co');
  deviceToken = await approvedDevice(company, await branchIn(company, 'pins'));
});

afterAll(async () => {
  await h.close();
});

const verify = (body: object, headers: Record<string, string> = {}) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/cashier-pin/verify',
    headers: { authorization: `Device ${deviceToken}`, ...headers },
    payload: body,
  });
const code = (res: Awaited<ReturnType<typeof verify>>) =>
  [res.statusCode, res.statusCode === 200 ? 'OK' : errorEnvelope.parse(res.json()).code] as const;
const setPin = (employeeId: string, pin: string, companyId = company) =>
  pins.setCashierPin.execute({ companyId, userId: managerId, employeeId, pin });
const pinKey = (employeeId: string, part: string) => `pin:${company}:${employeeId}:${part}`;
const unlock = (employeeId: string) =>
  h.redis.del(...['failures', 'reservations', 'lock'].map((part) => pinKey(employeeId, part)));

describe('setting a PIN', () => {
  it('stores only a salted hash, and audits the first set and every change', async () => {
    await setPin(EMPLOYEE, PIN);
    await setPin(EMPLOYEE, PIN);
    const rows = await h.owner`SELECT pin_hash FROM cashier_pins WHERE employee_id = ${EMPLOYEE}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['pin_hash']).toMatch(/^pbkdf2-sha256\$/);
    expect(rows[0]?.['pin_hash']).not.toContain(PIN);
    const actions =
      await h.owner`SELECT action FROM audit_log WHERE entity_id = ${EMPLOYEE} ORDER BY at, id`;
    expect(actions.map((a) => a['action'])).toEqual(['cashier_pin.set', 'cashier_pin.changed']);
  });

  it('refuses anything but four digits', async () => {
    for (const pin of ['123', '12345', '12a4']) {
      await expect(setPin(OTHER_EMPLOYEE, pin)).rejects.toBeInstanceOf(CashierPinMalformedError);
    }
  });
});

describe('verifying a PIN on a device', () => {
  it('the right PIN names the employee; a wrong PIN and an unknown employee are the same 401', async () => {
    expect(code(await verify({ employee_id: EMPLOYEE, pin: PIN }))).toEqual([200, 'OK']);
    expect((await verify({ employee_id: EMPLOYEE, pin: PIN })).json()).toEqual({
      employee_id: EMPLOYEE,
    });
    expect(code(await verify({ employee_id: EMPLOYEE, pin: '0000' }))).toEqual([
      401,
      'PIN_INVALID',
    ]);
    expect(code(await verify({ employee_id: OTHER_EMPLOYEE, pin: PIN }))).toEqual([
      401,
      'PIN_INVALID',
    ]);
    await Promise.all([unlock(EMPLOYEE), unlock(OTHER_EMPLOYEE)]);
  });

  it("another company's PIN is invisible to this company's device", async () => {
    const stranger = '01920000-0000-7000-8000-0000000000f3';
    await setPin(stranger, PIN, otherCompany);
    expect(code(await verify({ employee_id: stranger, pin: PIN }))).toEqual([401, 'PIN_INVALID']);
    await unlock(stranger);
  });

  it('a malformed PIN is a 400 that costs no attempt; a user session is refused', async () => {
    expect(code(await verify({ employee_id: EMPLOYEE, pin: '12a4' }))).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
    const asUser = await h.app.inject({
      method: 'POST',
      url: '/v1/devices/me/cashier-pin/verify',
      headers: { cookie: owner, 'x-company-id': company },
      payload: { employee_id: EMPLOYEE, pin: PIN },
    });
    expect(asUser.statusCode).toBe(403);
    expect(await h.redis.get(pinKey(EMPLOYEE, 'failures'))).toBeNull();
  });
});

describe('lockout (PRD D-08)', () => {
  it('the fifth wrong PIN locks it: even the right PIN is refused, and the lock is audited', async () => {
    const statuses: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push(code(await verify({ employee_id: EMPLOYEE, pin: '0000' }))[1]);
    }
    expect(statuses).toEqual([...Array<string>(4).fill('PIN_INVALID'), 'PIN_LOCKED']);
    expect(code(await verify({ employee_id: EMPLOYEE, pin: PIN }))).toEqual([423, 'PIN_LOCKED']);
    const ttl = await h.redis.ttl(pinKey(EMPLOYEE, 'lock'));
    expect(ttl).toBeGreaterThan(890);
    expect(ttl).toBeLessThanOrEqual(900);
    const [locked] =
      await h.owner`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = ${EMPLOYEE} AND action = 'cashier_pin.locked'`;
    expect(locked?.['n']).toBe(1);
    await unlock(EMPLOYEE);
    expect(code(await verify({ employee_id: EMPLOYEE, pin: PIN }))).toEqual([200, 'OK']);
  });

  it('a burst of ten wrong PINs gets five comparisons, never more', async () => {
    const [before] =
      await h.owner`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = ${EMPLOYEE} AND action = 'cashier_pin.locked'`;
    const burst = await Promise.all(
      Array.from({ length: 10 }, () => verify({ employee_id: EMPLOYEE, pin: '0000' })),
    );
    const codes = burst.map((res) => code(res)[1]);
    expect(codes.filter((c) => c === 'PIN_INVALID')).toHaveLength(4);
    expect(
      codes.filter((c) => c === 'PIN_INVALID' || c === 'TOO_MANY_REQUESTS' || c === 'PIN_LOCKED'),
    ).toHaveLength(10);
    const [after] =
      await h.owner`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = ${EMPLOYEE} AND action = 'cashier_pin.locked'`;
    expect(Number(after?.['n']) - Number(before?.['n'])).toBe(1);
    await unlock(EMPLOYEE);
  });

  it('the right PIN clears earlier failures, so they do not add up with later ones', async () => {
    for (let i = 0; i < 4; i += 1) await verify({ employee_id: EMPLOYEE, pin: '0000' });
    expect(code(await verify({ employee_id: EMPLOYEE, pin: PIN }))).toEqual([200, 'OK']);
    for (let i = 0; i < 4; i += 1) {
      expect(code(await verify({ employee_id: EMPLOYEE, pin: '0000' }))).toEqual([
        401,
        'PIN_INVALID',
      ]);
    }
    await unlock(EMPLOYEE);
  });
});

const COUNTED = '01920000-0000-7000-8000-0000000000f9';
const target = () => ({ companyId: company, employeeId: COUNTED });
const k = (part: string) => `pin:${company}:${COUNTED}:${part}`;
const attempts = () => createRedisPinAttempts(h.redis, systemUuidV7());
const reserve = async (a: PinAttempts) => {
  const r = await a.reserve(target());
  if (r.kind !== 'ok') throw new Error(`expected a reservation, got ${r.kind}`);
  return r.reservation;
};
// A reservation whose deadline has passed, as if its request stalled for more than a minute.
const expire = (reservation: string) => h.redis.zadd(k('reservations'), 'XX', 0, reservation);
const reset = () => h.redis.del(k('lock'), k('reservations'), k('failures'));

describe('the attempt counters under concurrency', () => {
  it('no more than five comparisons can be in flight or failed at once', async () => {
    const a = attempts();
    const held = [];
    for (let i = 0; i < 5; i += 1) held.push(await reserve(a));
    expect((await a.reserve(target())).kind).toBe('busy');
    await a.release(target(), held[0] ?? '');
    expect((await a.reserve(target())).kind).toBe('ok');
    await reset();
  });

  it('a success that finishes while a lock exists neither verifies nor removes it', async () => {
    const a = attempts();
    const r = await reserve(a);
    await h.redis.set(k('lock'), '1', 'EX', 900);
    expect(await a.succeeded(target(), r)).toBe('locked');
    expect((await a.reserve(target())).kind).toBe('locked');
    await reset();
  });

  it('the lock has its own 15 minutes, and a later failure never extends it', async () => {
    const a = attempts();
    await h.redis.set(k('failures'), '4', 'EX', 1);
    expect(await a.failed(target(), await reserve(a))).toBe('locked');
    expect(await h.redis.ttl(k('lock'))).toBeGreaterThan(890);
    await new Promise((done) => setTimeout(done, 1100));
    expect((await a.reserve(target())).kind).toBe('locked');
    await reset();
    const inFlight = await reserve(a);
    await h.redis.set(k('lock'), '1', 'EX', 100);
    await h.redis.set(k('failures'), '4');
    expect(await a.failed(target(), inFlight)).toBe('locked');
    expect(await h.redis.ttl(k('lock'))).toBeLessThanOrEqual(100);
    await reset();
  });

  it('an expired reservation completes as expired and changes nothing', async () => {
    const a = attempts();
    const stalled = await reserve(a);
    await h.redis.set(k('failures'), '4');
    await expire(stalled);
    expect(await a.failed(target(), stalled)).toBe('expired');
    expect(await a.succeeded(target(), stalled)).toBe('expired');
    expect(await h.redis.get(k('failures'))).toBe('4');
    expect(await h.redis.exists(k('lock'))).toBe(0);
    await reset();
  });

  it('an abandoned reservation expires on its own, whatever traffic follows it', async () => {
    const a = attempts();
    const abandoned = await reserve(a);
    await h.redis.set(k('failures'), '4');
    expect((await a.reserve(target())).kind).toBe('busy');
    await expire(abandoned);
    const next = await reserve(a);
    expect(await a.succeeded(target(), next)).toBe('ok');
    expect(await h.redis.zcard(k('reservations'))).toBe(0);
    await reset();
  });
});

describe('logs', () => {
  it('the PIN never appears in a log line', () => {
    expect(logText.join('')).not.toContain(PIN);
  });
});
