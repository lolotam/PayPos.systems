import { createStaffPinResetApi } from '@pospay/auth';
import { systemUuidV7 } from '@pospay/ids';
import { createEmailIdentity, createPhoneIdentity, phoneLockKey } from '@pospay/notifications';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addEmployee,
  capturedLogs,
  grant,
  nextPhone,
  staffAccessFixture,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';
import { origin, paired } from '../../../../test/staff-otp-harness.ts';
import { createOtpCrypto } from '../../../../../../packages/auth/src/staff-otp/crypto.ts';
import { createStaffOtpDatabase } from '../../../../../../packages/db/src/staff-otp-database.ts';
import { warmOtpTables } from '../../../../../../packages/db/test/otp-fixtures.ts';
import { systemClock } from '../../../shared/adapters/system-clock.ts';
import { authPinHasher } from '../persistence/auth-pin-hasher.ts';
import { redisOtpRates } from '../persistence/redis-otp-rates.ts';
import { createRedisPinAttempts } from '../persistence/redis-pin-attempts.ts';
import { createStaffEligibility } from '../persistence/staff-eligibility.ts';
import { createStaffPinTransactions } from '../persistence/staff-pin-transactions.ts';
import { createStaffRecoveryReader } from '../persistence/staff-recovery-reader.ts';
import { RecoverStaffPin } from '../use-cases/recover-staff-pin/recover-staff-pin.ts';

// استعادة الموظفة رقمها السري بنفسها (spec 079 PR-c1) على قاعدة حقيقية وRedis حقيقي: الإيميل يعمل
// من غير الواتساب، والرد موحّد، والكود يُستهلك مرة، والرقم دائم، والمالك يوصله جرس من غير أي سر.
const keys = {
  derivationId: 'synthetic-d',
  verificationId: 'synthetic-v',
  derivation: new Map([['synthetic-d', Buffer.alloc(32, 17)]]),
  verification: new Map([['synthetic-v', Buffer.alloc(32, 29)]]),
};
const emailIdentity = createEmailIdentity('synthetic'.repeat(8), 'synthetic-h');
const phoneIdentity = createPhoneIdentity('synthetic'.repeat(8), 'synthetic-h');
const NEW_PIN = '5678';
const jobs: { challengeId: string; attemptId: string }[] = [];

const ids = systemUuidV7();
let f: Fixture;
let device: Awaited<ReturnType<typeof paired>>;
let authDb: ReturnType<typeof createStaffOtpDatabase>;
let pinReset: ReturnType<typeof createStaffPinResetApi>;
let employeeNumber = 700;

beforeAll(async () => {
  f = await staffAccessFixture({
    staffAccessRoutes: true,
    staffOrigin: origin,
    staffPinResetFactory: (_auth, url, database, redis) => {
      const ids = systemUuidV7();
      pinReset = createStaffPinResetApi({
        databaseUrl: url,
        emailConfiguration: () => ({ state: 'READY', keys, fingerprint: 'synthetic' }),
        whatsappConfiguration: () => ({ state: 'DISABLED', reason: 'TEMPLATE_NOT_APPROVED' }),
        capability: { EMAIL: { ready: async () => true }, WHATSAPP: { ready: async () => true } },
        rates: redisOtpRates(redis, 'synthetic'.repeat(8), ids, 'staff-pin-reset-otp'),
        sender: {
          enqueue: async (job) => {
            jobs.push(job);
          },
        },
        strategies: {
          identify: phoneIdentity.identify,
          phoneLockKey,
          identifyEmail: emailIdentity.identify,
        },
        eligibility: createStaffEligibility(database),
        recovery: createStaffRecoveryReader(database),
        pins: new RecoverStaffPin(
          createStaffPinTransactions(database, ids),
          authPinHasher,
          createRedisPinAttempts(redis, ids),
          systemClock,
        ),
        ids,
        clock: {
          now: () => new Date(),
          waitUntil: (deadline) =>
            new Promise((resolve) =>
              setTimeout(resolve, Math.max(0, deadline.getTime() - Date.now())),
            ),
        },
      });
      return pinReset;
    },
  });
  device = await paired(f.h, f.ownerCookie, f.company, f.salmiya);
  authDb = createStaffOtpDatabase({ url: f.h.urls.auth, phoneLockKey });
  await warmOtpTables(f.h.owner);
  await pinReset.readiness();
  await authDb.ping();
});

afterAll(async () => {
  await authDb?.close();
  await f?.db.close();
  await f?.h.close();
});

/** موظفة جديدة بدخول فعّال وإيميل استعادة مسجّل من مسار «إعطاء الدخول» نفسه. */
async function staffWithEmail(email: string) {
  employeeNumber += 1;
  const employee = await addEmployee(f, `Reset ${employeeNumber}`, f.salmiya, employeeNumber);
  const phone = nextPhone(f);
  const granted = await grant(f, employee, phone, f.ownerCookie, { recovery_email: email });
  expect(granted.status).toBe(200);
  const [record] = await f.h.owner`SELECT user_id FROM employee_staff_access
    WHERE employee_id=${employee}`;
  return { employee, phone, userId: record?.['user_id'] as string };
}

const post = (path: string, payload: object) =>
  f.h.app.inject({
    method: 'POST',
    url: `/v1/devices/me/staff-pin/${path}`,
    headers: { authorization: `Device ${device.token}`, origin },
    payload: payload as Record<string, unknown>,
  });

const requestCode = (identifier: string, channel: 'EMAIL' | 'WHATSAPP' = 'EMAIL') =>
  post('otp/request', { channel, identifier, locale: 'en' });
const resetWith = (challengeId: string, code: string, pin = NEW_PIN) =>
  post('otp/reset', { challenge_id: challengeId, code, pin });

async function codeOf(challengeId: string): Promise<string> {
  const challenge = await authDb.find(challengeId);
  if (challenge === null) throw new Error('missing challenge');
  return createOtpCrypto(keys).derive(challenge);
}

describe('recovering the PIN with an email code', () => {
  it('saves the normalized address and refuses the same address for a second employee', async () => {
    const first = await staffWithEmail('Sara.Dup@Example.Test');
    const [stored] = await f.h
      .owner`SELECT recovery_email, revision FROM employees WHERE id=${first.employee}`;
    expect(stored?.['recovery_email']).toBe('sara.dup@example.test');
    expect(stored?.['revision']).toBe(3);
    const [audit] = await f.h.owner`SELECT before, after FROM audit_log
      WHERE entity_id=${first.employee} AND action='updated' ORDER BY id LIMIT 1`;
    expect(audit?.['before']).toMatchObject({ recovery_email: null });
    expect(audit?.['after']).toMatchObject({ recovery_email: 'SET' });
    expect(JSON.stringify(audit)).not.toContain('example.test');
    employeeNumber += 1;
    const second = await addEmployee(f, `Dup ${employeeNumber}`, f.salmiya, employeeNumber);
    const refused = await grant(f, second, nextPhone(f), f.ownerCookie, {
      recovery_email: 'sara.DUP@example.test',
    });
    expect(refused.status).toBe(409);
    expect(refused.body['code']).toBe('EMPLOYEE_RECOVERY_EMAIL_TAKEN');
    expect(
      await f.h.owner`SELECT 1 FROM employee_staff_access WHERE employee_id=${second}`,
    ).toHaveLength(0);
  });

  it('answers 202, sends one job, and sets a permanent PIN that ends the lockout', async () => {
    const staff = await staffWithEmail('permanent@example.test');
    const [before] = await f.h.owner`SELECT id FROM cashier_pins WHERE user_id=${staff.userId}`;
    for (let attempt = 0; attempt < 5; attempt += 1)
      await post('sign-in', { phone: staff.phone, pin: '9999' });
    const requested = await requestCode('permanent@example.test');
    expect(requested.statusCode).toBe(202);
    const body = requested.json() as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'ACCEPTED', expires_in: 600, retry_after: 60 });
    expect(jobs.at(-1)?.challengeId).toBe(body['challenge_id']);
    const code = await codeOf(body['challenge_id'] as string);
    expect((await resetWith(body['challenge_id'] as string, '000000')).statusCode).toBe(401);
    const done = await resetWith(body['challenge_id'] as string, code);
    expect(done.statusCode).toBe(204);
    const [after] = await f.h
      .owner`SELECT id,temporary,expires_at,set_by FROM cashier_pins WHERE user_id=${staff.userId}`;
    expect(after).toMatchObject({ temporary: false, expires_at: null, set_by: null });
    expect(after?.['id']).not.toBe(before?.['id']);
    const replay = await resetWith(body['challenge_id'] as string, code);
    expect(replay.statusCode).toBe(401);
    const signedIn = await post('sign-in', { phone: staff.phone, pin: NEW_PIN });
    expect(signedIn.statusCode).toBe(200);
  });
});

describe('what the recovery leaves behind', () => {
  it('tells the owner without carrying the PIN, the code or the address anywhere', async () => {
    const staff = await staffWithEmail('quiet@example.test');
    const requested = (await requestCode('quiet@example.test')).json() as { challenge_id: string };
    const code = await codeOf(requested.challenge_id);
    expect((await resetWith(requested.challenge_id, code)).statusCode).toBe(204);
    const events = await f.h.owner`SELECT event_type, payload FROM outbox
      WHERE aggregate_id=${staff.employee} AND event_type='StaffPinRecovered'`;
    expect(events.length).toBeGreaterThan(0);
    const [audit] = await f.h.owner`SELECT action, after FROM audit_log
      WHERE entity_id=${staff.userId} AND action='staff.pin_recovered'`;
    expect(audit?.['action']).toBe('staff.pin_recovered');
    const [platform] = await f.h.owner`SELECT action FROM platform_audit_log
      WHERE target_user_id=${staff.userId} AND action='staffpin.reset_completed'`;
    expect(platform?.['action']).toBe('staffpin.reset_completed');
    const everything = JSON.stringify([events, audit, capturedLogs()]);
    for (const secret of [NEW_PIN, code, 'quiet@example.test'])
      expect(everything).not.toContain(secret);
  });

  it('exhausts the challenge after five wrong codes, even for the right code afterwards', async () => {
    await staffWithEmail('exhaust@example.test');
    const requested = (await requestCode('exhaust@example.test')).json() as {
      challenge_id: string;
    };
    const code = await codeOf(requested.challenge_id);
    for (let attempt = 0; attempt < 5; attempt += 1)
      await resetWith(requested.challenge_id, '000001');
    expect((await resetWith(requested.challenge_id, code)).statusCode).toBe(401);
  });
});

async function otherCompanyDevice() {
  const otherCookie = await f.h.signedInOperator('other-company-owner@example.test');
  const otherCompany = await f.h.onboard(otherCookie, 'Other Company');
  const otherBusiness = ids.newId();
  const otherBranch = ids.newId();
  await f.h.owner`INSERT INTO businesses (company_id,id,name_en,vertical_type)
    VALUES (${otherCompany},${otherBusiness},'Other salon','salon')`;
  await f.h.owner`INSERT INTO branches (company_id,id,business_id,name_en)
    VALUES (${otherCompany},${otherBranch},${otherBusiness},'Other branch')`;
  return paired(f.h, otherCookie, otherCompany, otherBranch);
}

describe('the answer never shows who exists', () => {
  it('answers the same for an unknown address, a stopped employee and another company', async () => {
    const stopped = await staffWithEmail('stopped@example.test');
    await f.h
      .owner`UPDATE employee_staff_access SET state='STOPPED' WHERE user_id=${stopped.userId}`;
    // موظفتان في شركة الجهاز: الأولى يُطلب لها من جهاز شركة تانية (بلا إرسال)، والتانية من جهازها هي.
    await staffWithEmail('cross-company@example.test');
    const known = await staffWithEmail('visible@example.test');
    const otherDevice = await otherCompanyDevice();
    const jobsBefore = jobs.length;
    const answers = [
      await requestCode('nobody@example.test'),
      await requestCode('stopped@example.test'),
      await f.h.app.inject({
        method: 'POST',
        url: '/v1/devices/me/staff-pin/otp/request',
        headers: { authorization: `Device ${otherDevice.token}`, origin },
        payload: { channel: 'EMAIL', identifier: 'cross-company@example.test', locale: 'en' },
      }),
      await requestCode('visible@example.test'),
    ];
    for (const response of answers) expect(response.statusCode).toBe(202);
    const shapes = answers.map((response) => Object.keys(response.json()).sort().join());
    expect(new Set(shapes).size).toBe(1);
    expect(jobs.length - jobsBefore).toBe(1);
    expect(known.userId).toBeTruthy();
  });

  it('keeps a code from one device unusable on another and refuses a malformed identifier', async () => {
    await staffWithEmail('bound@example.test');
    const requested = (await requestCode('bound@example.test')).json() as { challenge_id: string };
    const code = await codeOf(requested.challenge_id);
    const other = await paired(f.h, f.ownerCookie, f.company, f.salmiya);
    const wrong = await f.h.app.inject({
      method: 'POST',
      url: '/v1/devices/me/staff-pin/otp/reset',
      headers: { authorization: `Device ${other.token}`, origin },
      payload: { challenge_id: requested.challenge_id, code, pin: NEW_PIN },
    });
    expect(wrong.statusCode).toBe(401);
    expect((await requestCode('not-an-email')).statusCode).toBe(400);
  });
});

describe('the channels do not depend on each other', () => {
  it('refuses WhatsApp with OTP_UNAVAILABLE while email keeps working', async () => {
    await staffWithEmail('channels@example.test');
    const whatsapp = await requestCode('+96551234999', 'WHATSAPP');
    expect(whatsapp.statusCode).toBe(503);
    expect((whatsapp.json() as { code: string }).code).toBe('OTP_UNAVAILABLE');
    expect((await requestCode('channels@example.test')).statusCode).toBe(202);
  });
});
