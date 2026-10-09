import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { personalFixture } from '../../../../test/personal-staff.fixture.ts';
import { attendanceInstallationSignal } from '@pospay/contracts';
import {
  installationHash,
  recordAttendanceDeviceSignal,
} from '../persistence/attendance-device-signal.ts';
import {
  sharedInstallations,
  sharedInstallationsStatement,
} from '../queries/shared-installations.query.ts';
import { SHARED_INSTALLATION_WINDOW_MS } from '../domain/shared-installation.ts';

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
const query = () => ({
  companyId: f.companyId,
  branches: [{ businessId: f.businessId, branchId: f.branchId }],
  from: new Date('2026-10-04T10:00:00Z'),
  to: new Date('2026-10-04T11:00:00Z'),
  windowMs: SHARED_INSTALLATION_WINDOW_MS,
  limit: 1,
});

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

it('the board query flags inclusive ten minutes, excludes repeated employee and scopes both employees before pagination', async () => {
  const records = [
    record(f.employeeId, '2026-10-04T10:01:00Z'),
    record(secondEmployee, '2026-10-04T10:10:00Z'),
    record(secondEmployee, '2026-10-04T10:20:00.001Z'),
    record(secondEmployee, '2026-10-04T10:02:00Z', '87654321-4321-4321-8321-cba987654321'),
  ];
  await f.database.withTenant(f.companyId, async (tx) => {
    for (const signal of records) await recordAttendanceDeviceSignal(tx, signal);
  });
  const first = await f.database.withTenant(f.companyId, (tx) => sharedInstallations(tx, query()));
  expect(first.items).toHaveLength(1);
  expect(first.next_cursor).not.toBeNull();
  const [firstId, secondId] = String(first.next_cursor).split(':');
  const next = await f.database.withTenant(f.companyId, (tx) =>
    sharedInstallations(tx, {
      ...query(),
      cursor: { first: String(firstId), second: String(secondId) },
    }),
  );
  expect(next.items).toHaveLength(1);
  expect(next.next_cursor).toBeNull();
  expect(first.items[0]?.first_signal_id).not.toBe(next.items[0]?.first_signal_id);
  expect(
    [...first.items, ...next.items].every(
      (flag) => flag.first_employee_id !== flag.second_employee_id,
    ),
  ).toBe(true);
  expect(JSON.stringify(first)).not.toContain('hash');
  expect(
    (
      await f.database.withTenant(f.companyId, (tx) =>
        sharedInstallations(tx, { ...query(), branches: [] }),
      )
    ).items,
  ).toEqual([]);
  expect(
    (await f.database.withTenant(f.otherCompany, (tx) => sharedInstallations(tx, query()))).items,
  ).toEqual([]);
});

function planNodes(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(planNodes);
  if (typeof node !== 'object' || node === null) return [];
  const record = node as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap(planNodes)];
}

it('the scoped pair query range-scans the business branch index; invalid windows fail before SQL', async () => {
  await f.owner`INSERT INTO attendance_device_signals(company_id,id,business_id,branch_id,employee_id,clock_event_id,installation_hash,clocked_at)
    SELECT ${f.companyId},gen_random_uuid(),${f.businessId},${f.branchId},
      CASE WHEN i%2=0 THEN ${f.employeeId}::uuid ELSE ${secondEmployee}::uuid END,
      gen_random_uuid(),md5(i::text)||md5((i+100000)::text),'2026-01-01T00:00:00Z'::timestamptz+i*interval '1 minute'
    FROM generate_series(1,5000) AS i`;
  await f.owner`ANALYZE attendance_device_signals`;
  const plan = await f.database.withTenant(f.companyId, (tx) =>
    tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${sharedInstallationsStatement(query())}`),
  );
  const nodes = planNodes(plan);
  const scoped = nodes.find(
    (node) => node['Index Name'] === 'attendance_device_signals_branch_time_idx',
  );
  expect(String(scoped?.['Index Cond'])).toMatch(/business_id[\s\S]*branch_id[\s\S]*clocked_at/);
  expect(nodes.some((node) => node['Node Type'] === 'Seq Scan')).toBe(false);
  expect(JSON.stringify(plan)).toContain('attendance_device_signals_hash_time_idx');
  const statement = new PgDialect().sqlToQuery(sharedInstallationsStatement(query())).sql;
  expect(statement.split('FROM')[0]).not.toContain('installation_hash');
  for (const windowMs of [-1, NaN, Infinity])
    await expect(
      f.database.withTenant(f.companyId, (tx) => sharedInstallations(tx, { ...query(), windowMs })),
    ).rejects.toThrow('INVALID_SHARED_INSTALLATION_QUERY');
});

it('company managers can query across businesses only when both branches are authorized', async () => {
  const businessId = f.ids.newId(),
    branchId = f.ids.newId(),
    employeeId = f.ids.newId();
  await f.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES(${f.companyId},${businessId},'Synthetic second business','salon')`;
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.companyId},${branchId},${businessId},'Synthetic second business branch')`;
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date) VALUES(${f.companyId},${employeeId},${businessId},${branchId},'Synthetic cross-business staff',${employeeNameMatchKey('Synthetic cross-business staff')},'staff','2026-01-01')`;
  await f.database.withTenant(f.companyId, async (tx) => {
    await recordAttendanceDeviceSignal(tx, record(f.employeeId, '2026-10-05T10:00:00Z'));
    await recordAttendanceDeviceSignal(tx, {
      ...record(employeeId, '2026-10-05T10:01:00Z'),
      businessId,
      branchId,
    });
  });
  const scope = {
    ...query(),
    from: new Date('2026-10-05T10:00:00Z'),
    to: new Date('2026-10-05T11:00:00Z'),
  };
  expect(
    (await f.database.withTenant(f.companyId, (tx) => sharedInstallations(tx, scope))).items,
  ).toHaveLength(0);
  expect(
    (
      await f.database.withTenant(f.companyId, (tx) =>
        sharedInstallations(tx, {
          ...scope,
          branches: [...scope.branches, { businessId, branchId }],
        }),
      )
    ).items,
  ).toHaveLength(1);
  await expect(
    f.database.withTenant(f.companyId, (tx) =>
      recordAttendanceDeviceSignal(tx, { ...record(employeeId, '2026-10-05T10:02:00Z'), branchId }),
    ),
  ).rejects.toThrow();
});
