import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { personalFixture } from '../../../../test/personal-staff.fixture.ts';
import { attendanceInstallationSignal } from '@pospay/contracts';
import {
  installationHash,
  recordAttendanceDeviceSignal,
} from '../persistence/attendance-device-signal.ts';

let f: Awaited<ReturnType<typeof personalFixture>>;
let secondEmployee: string;
const installationId = '12345678-1234-4234-8234-123456789abc';
beforeAll(async () => {
  f = await personalFixture();
  secondEmployee = f.ids.newId();
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${f.companyId},${secondEmployee},${f.businessId},${f.branchId},'Synthetic second staff',${employeeNameMatchKey('Synthetic second staff')},'staff','2026-01-01')`;
});
afterAll(async () => {
  await f?.close();
});

function record(employeeId: string, at: string, install = installationId) {
  return {
    companyId: f.companyId,
    id: f.ids.newId(),
    businessId: f.businessId,
    branchId: f.branchId,
    employeeId,
    clockEventId: f.ids.newId(),
    installationId: install,
    clockedAt: new Date(at),
  };
}

it('accepts only a random v4 install identifier, hashes in company scope, and stores no raw signal', async () => {
  expect(
    attendanceInstallationSignal.safeParse({ installation_id: 'browser-fingerprint' }).success,
  ).toBe(false);
  expect(attendanceInstallationSignal.safeParse({ installation_id: f.employeeId }).success).toBe(
    false,
  );
  expect(installationHash(f.companyId, installationId)).not.toBe(
    installationHash(f.otherCompany, installationId),
  );
  expect(installationHash(f.companyId, installationId.toUpperCase())).toBe(
    installationHash(f.companyId, installationId),
  );
  const first = record(f.employeeId, '2026-10-04T10:00:00Z');
  await f.database.withTenant(f.companyId, async (tx) => {
    await recordAttendanceDeviceSignal(tx, first);
    await recordAttendanceDeviceSignal(tx, { ...first, id: f.ids.newId() });
  });
  const saved =
    await f.owner`SELECT * FROM attendance_device_signals WHERE clock_event_id=${first.clockEventId}`;
  expect(saved).toHaveLength(1);
  expect(saved[0]?.['installation_hash']).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(saved)).not.toContain(installationId);
});

it('FORCE RLS rejects foreign inserts and hides foreign reads; records are immutable', async () => {
  const signal = record(secondEmployee, '2026-10-04T10:10:00Z');
  await expect(
    f.database.withTenant(f.otherCompany, (tx) => recordAttendanceDeviceSignal(tx, signal)),
  ).rejects.toThrow();
  expect(
    await f.database.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`SELECT id FROM attendance_device_signals`),
    ),
  ).toHaveLength(0);
  await expect(
    f.database.withTenant(f.companyId, (tx) =>
      tx.execute(sql`UPDATE attendance_device_signals SET clocked_at=clock_timestamp()`),
    ),
  ).rejects.toThrow();
  await expect(
    f.database.withTenant(f.companyId, (tx) =>
      tx.execute(sql`DELETE FROM attendance_device_signals`),
    ),
  ).rejects.toThrow();
  const [table] =
    await f.owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='attendance_device_signals'`;
  expect(table).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  await expect(
    f.database.withTenant(f.companyId, async (tx) => {
      await recordAttendanceDeviceSignal(tx, signal);
      throw new Error('SYNTHETIC_ROLLBACK');
    }),
  ).rejects.toThrow();
  expect(
    await f.owner`SELECT id FROM attendance_device_signals WHERE id=${signal.id}`,
  ).toHaveLength(0);
});
