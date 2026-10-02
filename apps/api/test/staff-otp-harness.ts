import { present } from '../../../packages/db/test/present.ts';
import { warmOtpTables } from '../../../packages/db/test/otp-fixtures.ts';
import { createStaffOtpApi, type StaffOtpApi, type StaffSessions } from '@pospay/auth';
import { createPhoneIdentity, phoneLockKey } from '@pospay/notifications';
import { systemUuidV7 } from '@pospay/ids';
import { createStaffEligibility } from '../src/modules/identity/persistence/staff-eligibility.ts';
import { redisOtpRates } from '../src/modules/identity/persistence/redis-otp-rates.ts';
import { createOtpCrypto } from '../../../packages/auth/src/staff-otp/crypto.ts';
import {
  createStaffOtpDatabase,
  type StaffOtpDatabase,
} from '../../../packages/db/src/staff-otp-database.ts';
import { startHarness, type Harness } from './harness.ts';

export const origin = 'http://pos.synthetic.invalid';
export const phone = '+99900000001';
export const keys = {
  derivationId: 'synthetic-d',
  verificationId: 'synthetic-v',
  derivation: new Map([['synthetic-d', Buffer.alloc(32, 17)]]),
  verification: new Map([['synthetic-v', Buffer.alloc(32, 29)]]),
};
export const identity = createPhoneIdentity('synthetic'.repeat(8), 'synthetic-h');

interface StaffHarness {
  control: { loseEnqueueAck: boolean };
  h: Harness;
  jobs: { challengeId: string; attemptId: string }[];
  db: StaffOtpDatabase;
  sessionFailures: string[];
  outcomes: string[];
  failures: string[];
  windowStarts: number[];
  code(id: string): Promise<string>;
  close(): Promise<void>;
}
export async function staffHarness(): Promise<StaffHarness> {
  let api: StaffOtpApi;
  const sessionFailures: string[] = [];
  const outcomes: string[] = [];
  const failures: string[] = [];
  const jobs: { challengeId: string; attemptId: string }[] = [];
  const requestTimer = requestClock();
  const control = { loseEnqueueAck: false };
  const h = await startHarness({
    staffOrigin: origin,
    staffOtpFactory: (auth, url, database, redis) => {
      const staff = present(auth.staff);
      api = createStaffOtpApi({
        onFailure: (phase, failure) => failures.push(`${phase}:${failure}`),
        onOutcome: (outcome) => outcomes.push(outcome),
        databaseUrl: url,
        configuration: otpConfiguration,
        capability: {
          ready: async (deadline) => {
            if (deadline !== undefined) return Date.now() < deadline.getTime();
            if ('ping' in database && typeof database.ping === 'function') await database.ping();
            await api.readiness();
            return true;
          },
        },
        rates: redisOtpRates(redis, 'synthetic'.repeat(8), systemUuidV7()),
        sender: syntheticSender(jobs, control),
        strategies: { identify: identity.identify, phoneLockKey },
        eligibility: createStaffEligibility(database),
        sessions: observedSessions(staff, sessionFailures),
        ids: systemUuidV7(),
        clock: requestTimer,
        audit: async (action, userId, device, challengeId) =>
          auth.recordPlatformAction({
            actor: present(userId),
            action,
            targetUserId: userId,
            details: { deviceId: device.deviceId, challengeId },
          }),
      });
      return api;
    },
  });
  const db = await observedDatabase(h);
  return {
    control,
    h,
    jobs,
    db,
    sessionFailures,
    outcomes,
    failures,
    windowStarts: requestTimer.starts,
    code: (id) => deriveChallenge(db, id),
    close: () => closeHarness(db, h),
  };
}

async function observedDatabase(h: Harness): Promise<StaffOtpDatabase> {
  const db = createStaffOtpDatabase({ url: h.urls.auth, phoneLockKey });
  try {
    await warmOtpTables(h.owner);
    await db.ping();
    return db;
  } catch (error) {
    await db.close().catch(() => undefined);
    await h.close().catch(() => undefined);
    throw error;
  }
}

function syntheticSender(jobs: StaffHarness['jobs'], control: StaffHarness['control']) {
  return {
    enqueue: async (ids: StaffHarness['jobs'][number]) => {
      jobs.push(ids);
      if (control.loseEnqueueAck) throw new Error('SYNTHETIC_ENQUEUE_ACK_LOST');
    },
  };
}

async function closeHarness(db: StaffOtpDatabase, h: Harness): Promise<void> {
  await db.close();
  await h.close();
}

function requestClock() {
  const starts: number[] = [];
  return {
    starts,
    ...clock,
    now: () => {
      starts.push(performance.now());
      return new Date();
    },
  };
}

async function deriveChallenge(db: StaffOtpDatabase, id: string): Promise<string> {
  return createOtpCrypto(keys).derive(present(await db.find(id)));
}

export async function paired(h: Harness, cookie: string, company: string, branch: string) {
  const response = await h.send('POST', `/v1/branches/${branch}/devices/pairing-code`, {
    cookie,
    company,
  });
  const registered = (
    await h.app.inject({
      method: 'POST',
      url: '/v1/devices/register',
      payload: { pairing_code: response.body['code'], label: 'synthetic till' },
    })
  ).json();
  await h.send('POST', `/v1/branches/${branch}/devices/${registered.device_id}/approve`, {
    cookie,
    company,
  });
  const claimed = (
    await h.app.inject({ method: 'POST', url: '/v1/devices/claim', payload: registered })
  ).json();
  return { id: registered.device_id as string, token: claimed.device_token as string };
}

const otpConfiguration = () => ({
  state: 'READY' as const,
  keys,
  fingerprint: 'synthetic',
  templates: { ar: 'synthetic_ar', en: 'synthetic_en' },
  posOrigin: origin,
});

function observedSessions(staff: StaffSessions, failures: string[]): StaffSessions {
  return {
    ...staff,
    issue: async (userId, device) => {
      try {
        return await staff.issue(userId, device);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'OPERATION_FAILED');
        throw error;
      }
    },
  };
}

const clock = {
  now: () => new Date(),
  waitUntil: (deadline: Date) =>
    new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(0, deadline.getTime() - Date.now())),
    ),
};
