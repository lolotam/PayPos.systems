import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { attendanceDeviceRefusalPage } from '@pospay/contracts';
import { attendanceFixture, type AttendanceFixture } from './clock-attendance.fixture.ts';
import { PHONE_X, PHONE_Y } from './passkey-device-lock.fixture.ts';
import {
  attendanceDeviceRefusals,
  attendanceDeviceRefusalsStatement,
} from '../queries/attendance-device-refusals.query.ts';
import { installationHash } from '../persistence/attendance-device-signal.ts';
import { installationLockStatement } from '../persistence/attendance-context.adapter.ts';

const PHONES = ['3f0c2b1a-4d5e-4f60-8a71-b2c3d4e5f601', '3f0c2b1a-4d5e-4f60-8a71-b2c3d4e5f602'];
let f: AttendanceFixture;
beforeAll(async () => {
  f = await attendanceFixture();
  await (await f.prepare()).execute();
  // ثلاثة تثبيتات مختلفة بنفس اللحظة؛ الرابع يكرر الأول داخل الدقيقة فيسقطه السقف.
  for (const installationId of [PHONE_Y, ...PHONES, PHONE_Y])
    await f.refusals.record({
      ...f.scope,
      branchId: f.branchId,
      installationId,
      step: 'CLOCK',
      reason: 'NOT_ENROLLED',
      holderEmployeeId: null,
      at: new Date('2026-10-10T12:00:00Z'),
    });
});
afterAll(async () => {
  await f?.close();
});
const query = () => ({
  companyId: f.companyId,
  businessId: f.businessId,
  branchId: f.branchId,
  from: new Date('2026-10-10'),
  to: new Date('2026-10-11'),
  limit: 2,
});

it('projects only the board contract and paginates tied timestamps without missing rows', async () => {
  const first = await f.database.withTenant(f.companyId, (tx) =>
    attendanceDeviceRefusals(tx, query()),
  );
  expect(attendanceDeviceRefusalPage.safeParse(first).success).toBe(true);
  expect(first.items).toHaveLength(2);
  expect(Object.keys(first.items[0] ?? {}).sort()).toEqual([
    'attempted_at',
    'branch_id',
    'employee_id',
    'holder_employee_id',
    'id',
    'reason',
    'step',
  ]);
  const [attemptedAt, id] = first.next_cursor?.split('|') ?? [];
  if (attemptedAt === undefined || id === undefined) throw new Error('MISSING_TEST_CURSOR');
  const second = await f.database.withTenant(f.companyId, (tx) =>
    attendanceDeviceRefusals(tx, { ...query(), cursor: { attemptedAt, id } }),
  );
  const ids = [...first.items, ...second.items].map((row) => row.id);
  expect(new Set(ids).size).toBe(3);
  expect(ids).toEqual([...ids].sort().reverse());
  expect(second.next_cursor).toBeNull();
  expect(JSON.stringify(first)).not.toContain('installation');
  expect(
    (await f.database.withTenant(f.otherCompany, (tx) => attendanceDeviceRefusals(tx, query())))
      .items,
  ).toEqual([]);
});

it('EXPLAIN uses the branch/time index and the active-installation partial index', async () => {
  await f.database.withTenant(f.companyId, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const board = await tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${attendanceDeviceRefusalsStatement(query())}`,
    );
    expect(JSON.stringify(board)).toContain('attendance_device_refusals_branch_time_idx');
    const lock = await tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON)
      ${installationLockStatement(f.scope, installationHash(f.companyId, PHONE_X))}`);
    expect(JSON.stringify(lock)).toContain('employee_passkeys_active_installation_idx');
  });
});
