import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { attendanceFixture, type AttendanceFixture } from './clock-attendance.fixture.ts';
import { ClockAttendance } from '../use-cases/clock-attendance/clock-attendance.ts';
import { IdempotencyKeyReusedError } from '@pospay/db';
import { attendanceWorkingDate } from '../domain/clock-attendance.ts';

let f: AttendanceFixture;
beforeAll(async () => {
  f = await attendanceFixture();
});
afterAll(async () => {
  await f?.close();
});

it('a state already exists before the first scan; concurrent signed scans open exactly one session and return the same result', async () => {
  expect(
    await f.owner`SELECT id FROM attendance_states WHERE company_id=${f.companyId} AND employee_id=${f.employeeId}`,
  ).toHaveLength(1);
  const a = await f.prepare(),
    b = await f.prepare();
  const results = await Promise.all([a.execute(), b.execute()]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({
    operation: 'CLOCK_IN',
    exceptions: ['NONE'],
    late_minutes: 0,
  });
  expect(
    await f.owner`SELECT id FROM attendance_sessions WHERE company_id=${f.companyId} AND status='OPEN'`,
  ).toHaveLength(1);
  expect(
    await f.owner`SELECT id FROM outbox WHERE company_id=${f.companyId} AND event_type='AttendanceClockedIn'`,
  ).toHaveLength(1);
  expect(await a.execute()).toEqual(results[0]);
  await expect(
    f.attendance.execute(f.scope, a.input, { ...a.idem, fingerprint: 'bb'.repeat(32) }),
  ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  await expect(
    f.attendance.execute(f.scope, a.input, { ...a.idem, key: f.ids.newId() }),
  ).rejects.toMatchObject({ code: 'PASSKEY_INVALID' });
});

it('UV is required even during dedupe; changed location and QR contexts cannot consume a challenge', async () => {
  const noUv = await f.prepare(f.scan(), false);
  await expect(noUv.execute()).rejects.toMatchObject({ code: 'PASSKEY_INVALID' });
  const changed = await f.prepare();
  await expect(
    f.attendance.execute(
      f.scope,
      { ...changed.input, location: { lat: 0, lng: 0, accuracy: 0 } },
      changed.idem,
    ),
  ).rejects.toMatchObject({ code: 'PASSKEY_INVALID' });
  expect(
    await f.owner`SELECT id FROM attendance_sessions WHERE company_id=${f.companyId}`,
  ).toHaveLength(1);
});

it('exactly five minutes permits close and resolves suspected missed-out without changing the working date', async () => {
  const [session] =
    await f.owner`SELECT id,working_date::text FROM attendance_sessions WHERE company_id=${f.companyId} AND status='OPEN'`;
  await f.owner`INSERT INTO attendance_exceptions(company_id,id,business_id,employee_id,branch_id,session_id,kind,raised_at)
    VALUES(${f.companyId},${f.ids.newId()},${f.businessId},${f.employeeId},${f.branchId},${session?.id as string},'SUSPECTED_MISSED_OUT',clock_timestamp())`;
  await f.owner`UPDATE attendance_states SET last_accepted_scan_at=${new Date(f.clock.now().getTime() - 300000)} WHERE company_id=${f.companyId}`;
  const result = await (await f.prepare()).execute();
  expect(result).toMatchObject({ operation: 'CLOCK_OUT', working_date: session?.working_date });
  expect(
    await f.owner`SELECT resolution FROM attendance_exceptions WHERE kind='SUSPECTED_MISSED_OUT'`,
  ).toMatchObject([{ resolution: 'CLOSED_LATE' }]);
});

it('exactly sixteen hours marks the previous session MISSED_OUT and opens a new one with two events atomically', async () => {
  await f.owner`UPDATE attendance_states SET last_accepted_scan_at=${new Date(f.clock.now().getTime() - 300000)} WHERE company_id=${f.companyId}`;
  const opened = await (await f.prepare()).execute();
  const start = new Date(f.clock.now().getTime() - 16 * 3600000);
  await f.owner`UPDATE attendance_sessions SET clock_in=${start} WHERE id=${opened.session_id}`;
  await f.owner`UPDATE attendance_states SET last_accepted_scan_at=${start} WHERE company_id=${f.companyId}`;
  const result = await (await f.prepare()).execute();
  expect(result.operation).toBe('CLOCK_IN');
  expect(result.missed_session_id).toBe(opened.session_id);
  const previous =
    await f.owner`SELECT status,clock_out FROM attendance_sessions WHERE id=${opened.session_id}`;
  expect(previous).toMatchObject([{ status: 'MISSED_OUT', clock_out: f.clock.now() }]);
  expect(
    await f.owner`SELECT id FROM attendance_sessions WHERE company_id=${f.companyId} AND status='OPEN'`,
  ).toHaveLength(1);
  expect(
    await f.owner`SELECT id FROM outbox WHERE event_type='AttendanceMissedOut' AND company_id=${f.companyId}`,
  ).toHaveLength(1);
});

it('binding revision, membership and dated attachment are rechecked inside the state lock', async () => {
  const old = await f.prepare();
  await f.owner`UPDATE employee_passkeys SET revision=2 WHERE id=${f.bindingId}`;
  await expect(old.execute()).rejects.toMatchObject({ code: 'PASSKEY_INVALID' });
  await f.owner`UPDATE employee_passkeys SET revision=1 WHERE id=${f.bindingId}`;
  const member = await f.prepare();
  await f.owner`UPDATE memberships SET ends_at=${new Date(f.clock.now().getTime() - 1)} WHERE id=${f.membershipId}`;
  await expect(member.execute()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await f.owner`UPDATE memberships SET ends_at=NULL WHERE id=${f.membershipId}`;
  const attached = await f.prepare();
  await f.owner`UPDATE employee_branches SET "to"='2026-02-01' WHERE employee_id=${f.employeeId}`;
  await expect(attached.execute()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await f.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.companyId},${f.ids.newId()},${f.businessId},${f.employeeId},${f.branchId},'2026-02-01')`;
});

it('a failed transaction rolls back attendance, audit, event and idempotency; retry requires a new assertion', async () => {
  await f.owner`UPDATE attendance_states SET last_accepted_scan_at=${new Date(f.clock.now().getTime() - 300000)} WHERE company_id=${f.companyId}`;
  const command = await f.prepare();
  const before = await f.owner`SELECT status FROM attendance_sessions ORDER BY id`;
  const audits = await f.owner`SELECT id FROM audit_log WHERE entity='attendance_session'`;
  const fail = new ClockAttendance(
    {
      run: (scope, scan, sample, work) =>
        f.transactions.run(scope, scan, sample, (tx, at) =>
          work(
            {
              ...tx,
              persist: async (write) => {
                await tx.persist(write);
                throw new Error('SYNTHETIC_ROLLBACK');
              },
            },
            at,
          ),
        ),
    },
    f.auth.passkeys,
    { verify: async () => true },
    f.clock,
    f.ids,
  );
  await expect(fail.execute(f.scope, command.input, command.idem)).rejects.toThrow(
    'SYNTHETIC_ROLLBACK',
  );
  expect(await f.owner`SELECT status FROM attendance_sessions ORDER BY id`).toEqual(before);
  expect(await f.owner`SELECT id FROM audit_log WHERE entity='attendance_session'`).toEqual(audits);
  expect(
    await f.owner`SELECT key FROM idempotency_keys WHERE key=${command.idem.key}`,
  ).toHaveLength(0);
  await expect(command.execute()).rejects.toMatchObject({ code: 'PASSKEY_INVALID' });
});

it('uses one sampled clock instant, including membership and QR verification', async () => {
  const command = await f.prepare();
  const now = vi.fn(() => f.clock.now());
  const qr = vi.fn(async (_company: string, _branch: string, _token: unknown, at: Date) => {
    expect(at).toEqual(f.clock.now());
    return true;
  });
  const useCase = new ClockAttendance(
    f.transactions,
    f.auth.passkeys,
    { verify: qr },
    { now },
    f.ids,
  );
  await useCase.execute(f.scope, command.input, command.idem);
  expect(now).toHaveBeenCalledTimes(1);
  expect(qr).toHaveBeenCalledTimes(1);
  await f.database.withTenant(f.companyId, async (tx) => {
    const rows = await tx.execute(sql`SELECT id FROM attendance_sessions`);
    expect(rows.length).toBeGreaterThan(0);
  });
});

it('the real QR verifier uses the locked branch without another tenant transaction', async () => {
  const tenant = vi.spyOn(f.database, 'withTenant');
  try {
    const command = await f.prepare();
    expect(tenant).toHaveBeenCalledTimes(1);
    tenant.mockClear();
    await command.execute();
    expect(tenant).toHaveBeenCalledTimes(1);
  } finally {
    tenant.mockRestore();
  }
});

it('an overnight close retains the clock-in working date instead of the next branch date', async () => {
  await f.owner`UPDATE attendance_states SET last_accepted_scan_at=${new Date(f.clock.now().getTime() - 300000)} WHERE company_id=${f.companyId}`;
  expect((await (await f.prepare()).execute()).operation).toBe('CLOCK_IN');
  const date = attendanceWorkingDate(f.clock.now(), 'Asia/Kuwait');
  const following = new Date(`${date}T00:00:00Z`);
  following.setUTCDate(following.getUTCDate() + 1);
  f.setNow(following);
  const start = new Date(`${date}T19:00:00Z`);
  await f.owner`UPDATE attendance_sessions SET clock_in=${start},working_date=${date} WHERE status='OPEN'`;
  await f.owner`UPDATE attendance_states SET last_accepted_scan_at=${start} WHERE company_id=${f.companyId}`;
  const result = await (await f.prepare()).execute();
  expect(result).toMatchObject({
    operation: 'CLOCK_OUT',
    working_date: date,
    accepted_at: f.clock.now().toISOString(),
  });
  const [row] =
    await f.owner`SELECT working_date::text,clock_out,status FROM attendance_sessions WHERE id=${result.session_id}`;
  expect(row).toMatchObject({
    working_date: date,
    clock_out: f.clock.now(),
    status: 'CLOSED',
  });
});
