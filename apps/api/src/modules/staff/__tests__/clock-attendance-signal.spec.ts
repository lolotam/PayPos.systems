import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  attendanceFixture,
  SYNTHETIC_INSTALLATION,
  type AttendanceFixture,
} from './clock-attendance.fixture.ts';
import { ClockAttendance } from '../use-cases/clock-attendance/clock-attendance.ts';
import { installationHash } from '../persistence/attendance-device-signal.ts';

const OTHER_INSTALLATION = '87654321-4321-4321-8321-cba987654321';
let f: AttendanceFixture;
beforeAll(async () => {
  f = await attendanceFixture();
});
afterAll(async () => {
  await f?.close();
});

const signals = () =>
  f.owner`SELECT s.clock_event_id,s.employee_id,s.business_id,s.branch_id,s.installation_hash,s.clocked_at,
    a.entity_id,a.action FROM attendance_device_signals s
    LEFT JOIN audit_log a ON a.company_id=s.company_id AND a.id=s.clock_event_id
    WHERE s.company_id=${f.companyId} ORDER BY s.clocked_at,s.id`;
const permitNext = () =>
  f.owner`UPDATE attendance_states SET last_accepted_scan_at=${new Date(f.clock.now().getTime() - 300000)}
    WHERE company_id=${f.companyId} AND employee_id=${f.employeeId}`;

it('one accepted scan writes one hashed observation linked to its clocked_in audit; dedupe, replay and refusal write none', async () => {
  const a = await f.prepare(),
    b = await f.prepare();
  const [first, second] = await Promise.all([a.execute(), b.execute()]);
  expect(second).toEqual(first);
  expect(await a.execute()).toEqual(first);
  await expect((await f.prepare(f.scan(), false)).execute()).rejects.toMatchObject({
    code: 'PASSKEY_INVALID',
  });
  expect(await signals()).toEqual([
    {
      clock_event_id: expect.any(String),
      employee_id: f.employeeId,
      business_id: f.businessId,
      branch_id: f.branchId,
      installation_hash: installationHash(f.companyId, SYNTHETIC_INSTALLATION),
      clocked_at: new Date(first?.accepted_at ?? ''),
      entity_id: first?.session_id,
      action: 'clocked_in',
    },
  ]);
});

it('a close and a missed-out reopen are one observation per scan, linked to the scan movement, never to MISSED_OUT', async () => {
  await permitNext();
  const closed = await (await f.prepare(f.scan(), true, OTHER_INSTALLATION)).execute();
  expect(closed.operation).toBe('CLOCK_OUT');
  await permitNext();
  const opened = await (await f.prepare()).execute();
  const start = new Date(f.clock.now().getTime() - 16 * 3600000);
  await f.owner`UPDATE attendance_sessions SET clock_in=${start} WHERE id=${opened.session_id}`;
  await f.owner`UPDATE attendance_states SET last_accepted_scan_at=${start} WHERE company_id=${f.companyId}`;
  const reopened = await (await f.prepare()).execute();
  expect(reopened.missed_session_id).toBe(opened.session_id);
  const rows = await signals();
  expect(rows.map((row) => [row['entity_id'], row['action']])).toEqual([
    [expect.any(String), 'clocked_in'],
    [closed.session_id, 'clocked_out'],
    [opened.session_id, 'clocked_in'],
    [reopened.session_id, 'clocked_in'],
  ]);
  expect(rows[1]?.['installation_hash']).toBe(installationHash(f.companyId, OTHER_INSTALLATION));
  expect(
    await f.owner`SELECT id FROM audit_log WHERE company_id=${f.companyId} AND action='missed_out'`,
  ).toHaveLength(1);
});

it('a rolled-back clock leaves no observation', async () => {
  await permitNext();
  const command = await f.prepare();
  const before = await signals();
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
  expect(await signals()).toEqual(before);
});

it('the raw installation id never enters any attendance, audit, outbox or idempotency row; other tenants see nothing', async () => {
  for (const table of [
    'attendance_device_signals',
    'attendance_sessions',
    'attendance_states',
    'attendance_exceptions',
    'attendance_clock_challenges',
    'audit_log',
    'outbox',
    'idempotency_keys',
  ]) {
    const rows = await f.owner`SELECT row_to_json(t)::text AS row FROM ${f.owner(table)} t`;
    const dump = JSON.stringify(rows).toLowerCase();
    expect(dump).not.toContain(SYNTHETIC_INSTALLATION);
    expect(dump).not.toContain(OTHER_INSTALLATION);
  }
  expect(
    await f.database.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`SELECT id FROM attendance_device_signals`),
    ),
  ).toHaveLength(0);
  expect(installationHash(f.otherCompany, SYNTHETIC_INSTALLATION)).not.toBe(
    installationHash(f.companyId, SYNTHETIC_INSTALLATION),
  );
});
