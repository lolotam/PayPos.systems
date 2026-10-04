import type { Redis } from 'ioredis';
import { personalFixture, personalOrigin } from '../../../../test/personal-staff.fixture.ts';
import { testAuthenticator } from '../../../../../../packages/auth/src/__tests__/webauthn.fixture.ts';
import { hmacAttendanceQr } from '../persistence/hmac-attendance-qr.ts';
import { attendanceQrWindow } from '../domain/attendance-qr.ts';
import { ClockAttendance } from '../use-cases/clock-attendance/clock-attendance.ts';
import { RequestClockChallenge } from '../use-cases/request-clock-challenge/request-clock-challenge.ts';
import { createAttendanceTransactions } from '../persistence/attendance-transactions.ts';
import { createLockedAttendanceQrVerifier } from '../persistence/locked-attendance-qr.ts';
import type { AttendanceScan } from '../ports/clock-attendance.port.ts';
import { requestFingerprint } from '../../../shared/idempotency.ts';

export async function attendanceFixture(): Promise<
  Awaited<ReturnType<typeof personalFixture>> & AttendanceFixtureExtensions
> {
  const secret = 'ab'.repeat(32);
  const redis = { get: async () => secret } as unknown as Redis;
  const f = await personalFixture(redis);
  const issued = await f.auth.personal.issue(
    f.userId,
    { purpose: 'STAFF_PERSONAL', companyId: f.companyId, businessId: f.businessId },
    async () => true,
  );
  const scope = {
    userId: f.userId,
    sessionId: issued.id,
    companyId: f.companyId,
    businessId: f.businessId,
    employeeId: f.employeeId,
  };
  const device = testAuthenticator(true);
  const registration = await f.auth.passkeys.enrollmentOptions(scope);
  const passkeyId = await f.auth.passkeys.enroll(
    scope,
    registration.challengeId,
    device.registration(registration.options.challenge, personalOrigin, 'localhost'),
  );
  if (passkeyId === null) throw new Error('SYNTHETIC_ENROLLMENT_FAILED');
  const bindingId = f.ids.newId();
  await f.owner`INSERT INTO employee_passkeys(company_id,id,business_id,employee_id,passkey_id,revision,bound_at,bound_by)
    VALUES(${f.companyId},${bindingId},${f.businessId},${f.employeeId},${passkeyId},1,clock_timestamp(),${f.userId})`;
  const ceremony = attendanceCeremony(f, scope, device, secret);
  return {
    ...f,
    redis,
    scope,
    bindingId,
    device,
    ...ceremony,
    headers: { cookie: issued.cookie.split(';')[0] ?? '', origin: personalOrigin },
  };
}
function attendanceCeremony(
  f: Awaited<ReturnType<typeof personalFixture>>,
  scope: AttendanceFixtureExtensions['scope'],
  device: ReturnType<typeof testAuthenticator>,
  secret: string,
) {
  let instant = new Date();
  const clock = { now: () => new Date(instant) };
  const qr = createLockedAttendanceQrVerifier(
    { read: async () => secret, getOrCreate: async () => secret },
    hmacAttendanceQr,
  );
  const transactions = createAttendanceTransactions(f.database, f.ids);
  const challenge = new RequestClockChallenge(transactions, f.auth.passkeys, qr, clock);
  const attendance = new ClockAttendance(transactions, f.auth.passkeys, qr, clock, f.ids);
  const scan = (branchId = f.branchId): AttendanceScan => {
    const window = attendanceQrWindow(instant.getTime());
    return {
      token: {
        branch_id: branchId,
        window,
        sig: hmacAttendanceQr.sign(f.companyId, branchId, window, secret),
      },
    };
  };
  return {
    challenge,
    attendance,
    transactions,
    scan,
    prepare: (value = scan(), uv = true) =>
      prepareAttendance(f, scope, device, challenge, attendance, value, uv),
    clock,
    setNow: (at: Date) => {
      instant = at;
    },
  };
}
async function prepareAttendance(
  f: Awaited<ReturnType<typeof personalFixture>>,
  scope: AttendanceFixtureExtensions['scope'],
  device: ReturnType<typeof testAuthenticator>,
  challenge: RequestClockChallenge,
  attendance: ClockAttendance,
  value: AttendanceScan,
  uv: boolean,
) {
  const generated = await challenge.execute(scope, value);
  const options = generated.options as { challenge: string };
  const input = {
    ...value,
    challenge_id: generated.challenge_id,
    response: {
      ...device.assertion(options.challenge, personalOrigin, 'localhost', uv),
      clientExtensionResults: {},
    },
  };
  const idem = {
    key: f.ids.newId(),
    fingerprint: requestFingerprint({
      method: 'POST',
      route: '/v1/staff/attendance/clock',
      params: {},
      query: {},
      body: input,
    }),
  };
  return { input, idem, execute: () => attendance.execute(scope, input, idem) };
}
export type AttendanceFixture = Awaited<ReturnType<typeof attendanceFixture>>;
interface AttendanceFixtureExtensions {
  redis: Redis;
  scope: {
    userId: string;
    sessionId: string;
    companyId: string;
    businessId: string;
    employeeId: string;
  };
  bindingId: string;
  device: ReturnType<typeof testAuthenticator>;
  challenge: RequestClockChallenge;
  attendance: ClockAttendance;
  transactions: ReturnType<typeof createAttendanceTransactions>;
  scan(branchId?: string): AttendanceScan;
  prepare(
    value?: AttendanceScan,
    uv?: boolean,
  ): Promise<{
    input: AttendanceScan & {
      challenge_id: string;
      response: Parameters<ClockAttendance['execute']>[1]['response'];
    };
    idem: { key: string; fingerprint: string };
    execute(): ReturnType<ClockAttendance['execute']>;
  }>;
  clock: { now(): Date };
  headers: { cookie: string; origin: string };
  setNow(at: Date): void;
}
