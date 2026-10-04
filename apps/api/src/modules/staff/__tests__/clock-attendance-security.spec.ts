import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { attendanceFixture, type AttendanceFixture } from './clock-attendance.fixture.ts';
import { attendanceWorkingDate } from '../domain/clock-attendance.ts';
import { hmacAttendanceQr } from '../persistence/hmac-attendance-qr.ts';

let f: AttendanceFixture;
beforeAll(async () => {
  f = await attendanceFixture();
});
afterAll(async () => {
  await f?.close();
});

it('the single request instant is sampled after acquiring State, including a contended first scan', async () => {
  let release!: () => void, locked!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const acquired = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const blocker = f.owner.begin(async (tx) => {
    await tx`SELECT id FROM attendance_states WHERE employee_id=${f.employeeId} FOR UPDATE`;
    locked();
    await released;
  });
  await acquired;
  const sample = vi.fn(() => f.clock.now());
  const waiting = f.transactions.run(f.scope, f.scan(), sample, async () => true);
  try {
    await vi.waitFor(
      async () => {
        const rows = await f.owner`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE '%attendance_states%'`;
        expect(rows.length).toBeGreaterThan(0);
      },
      { timeout: 3000, interval: 20 },
    );
    expect(sample).not.toHaveBeenCalled();
  } finally {
    release();
    await blocker;
  }
  expect(await waiting).toBe(true);
  expect(sample).toHaveBeenCalledTimes(1);
});

it('membership expiry during the company lock wait is checked at the single instant sampled after every eligibility lock', async () => {
  const original = f.clock.now();
  const expires = new Date(original.getTime() + 1000);
  await f.owner`UPDATE memberships SET ends_at=${expires} WHERE id=${f.membershipId}`;
  let release!: () => void, locked!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const acquired = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const blocker = f.owner.begin(async (tx) => {
    await tx`SELECT id FROM companies WHERE id=${f.companyId} FOR NO KEY UPDATE`;
    locked();
    await released;
  });
  await acquired;
  const sample = vi.fn(() => f.clock.now());
  const waiting = f.transactions
    .run(f.scope, f.scan(), sample, async () => true)
    .catch((error: unknown) => error);
  try {
    await vi.waitFor(
      async () => {
        const rows = await f.owner`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE '%companies%'`;
        expect(rows.length).toBeGreaterThan(0);
      },
      { timeout: 3000, interval: 20 },
    );
    expect(sample).not.toHaveBeenCalled();
    f.setNow(expires);
  } finally {
    release();
    await blocker;
  }
  try {
    expect(await waiting).toMatchObject({ code: 'NOT_FOUND' });
    expect(sample).toHaveBeenCalledTimes(1);
  } finally {
    f.setNow(original);
    await f.owner`UPDATE memberships SET ends_at=NULL WHERE id=${f.membershipId}`;
  }
});

it('an operation challenge expires at exactly 120 seconds and bad/current/previous QR windows are checked', async () => {
  const expired = await f.prepare();
  await f.owner`UPDATE attendance_clock_challenges SET issued_at=${new Date(f.clock.now().getTime() - 120000)}
    WHERE id=${expired.input.challenge_id}`;
  await expect(expired.execute()).rejects.toMatchObject({ code: 'PASSKEY_INVALID' });
  const token = f.scan().token;
  await expect(
    f.challenge.execute(f.scope, { token: { ...token, sig: 'ff'.repeat(32) } }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  for (const delta of [-2, 1]) {
    const window = token.window + delta;
    const sig = hmacAttendanceQr.sign(f.companyId, f.branchId, window, 'ab'.repeat(32));
    await expect(
      f.challenge.execute(f.scope, { token: { ...token, window, sig } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  }
  const window = token.window - 1;
  const sig = hmacAttendanceQr.sign(f.companyId, f.branchId, window, 'ab'.repeat(32));
  expect(await f.challenge.execute(f.scope, { token: { ...token, window, sig } })).toHaveProperty(
    'challenge_id',
  );
  expect(await f.owner`SELECT id FROM attendance_sessions`).toHaveLength(0);
});

it('real schedule lateness and out-of-range location are report facts; clocking still commits with no financial event', async () => {
  const at = f.clock.now(),
    start = new Date(at.getTime() - 11 * 60000),
    end = new Date(at.getTime() + 3600000);
  const date = attendanceWorkingDate(start, 'Asia/Kuwait');
  const week = new Date(`${date}T00:00:00Z`);
  const day = (week.getUTCDay() + 1) % 7;
  week.setUTCDate(week.getUTCDate() - day);
  const schedule = f.ids.newId();
  const time = (instant: Date) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuwait',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(instant);
  await f.owner`UPDATE branches SET geo_lat=0,geo_lng=0 WHERE id=${f.branchId}`;
  await f.owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    VALUES(${f.companyId},${schedule},${f.businessId},${f.branchId},${f.employeeId},${week.toISOString().slice(0, 10)},'Asia/Kuwait',1)`;
  await f.owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    VALUES(${f.companyId},${f.ids.newId()},${schedule},${f.employeeId},${date},${day},${time(start)},${time(end)},${start},${end})`;
  const scan = { ...f.scan(), location: { lat: 1, lng: 1, accuracy: 0 } };
  const result = await (await f.prepare(scan)).execute();
  expect(result).toMatchObject({
    operation: 'CLOCK_IN',
    late_minutes: 11,
    exceptions: ['OUT_OF_RANGE'],
  });
  const [stored] =
    await f.owner`SELECT late_minutes,scheduled_start,binding_id,binding_revision,qr_window,geo,latitude,accuracy,device_id,operator_id
    FROM attendance_sessions WHERE id=${result.session_id}`;
  expect(stored).toMatchObject({
    late_minutes: 11,
    scheduled_start: start,
    binding_id: f.bindingId,
    binding_revision: 1,
    qr_window: scan.token.window,
    geo: 'OUT_OF_RANGE',
    latitude: 1,
    accuracy: 0,
    device_id: null,
    operator_id: null,
  });
  expect(await f.owner`SELECT event_type FROM outbox WHERE company_id=${f.companyId}`).toEqual([
    { event_type: 'AttendanceClockedIn' },
  ]);
  await f.database.withTenant(f.companyId, async (tx) => {
    expect(
      await tx.execute(
        sql`SELECT kind FROM attendance_exceptions WHERE session_id=${result.session_id}`,
      ),
    ).toMatchObject([{ kind: 'OUT_OF_RANGE' }]);
  });
});

it('an unbind committed after challenge issuance fences the assertion as an unknown binding', async () => {
  const command = await f.prepare();
  await f.owner`UPDATE employee_passkeys SET unbound_at=clock_timestamp(),unbound_by=${f.userId} WHERE id=${f.bindingId}`;
  await expect(command.execute()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(await f.owner`SELECT id FROM attendance_sessions WHERE status='OPEN'`).toHaveLength(1);
});
