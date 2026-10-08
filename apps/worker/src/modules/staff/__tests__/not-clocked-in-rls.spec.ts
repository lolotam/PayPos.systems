import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import {
  notClockedInFixture,
  SHIFT_END,
  SHIFT_START,
  ALERT_AT,
  type NotClockedInFixture,
  type Tenant,
} from './not-clocked-in.fixture.ts';

let f: NotClockedInFixture;
beforeAll(async () => {
  f = await notClockedInFixture();
});
afterAll(async () => {
  await f?.close();
});

async function notice(tenant: Tenant, employee: string) {
  await f.owner`INSERT INTO attendance_not_clocked_in_notices(company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,alert_due_at,notified_at,recipient_count)
    VALUES(${tenant.company},${f.ids.newId()},${tenant.business},${tenant.branch},${employee},${SHIFT_START},${SHIFT_END},${ALERT_AT},${ALERT_AT},0)`;
}

it('attendance_not_clocked_in_notices enforces FORCE RLS and refuses cross-tenant reads and writes', async () => {
  const a = await f.tenant();
  const b = await f.tenant();
  const employee = await f.employee(a);
  await notice(a, employee);
  const [flags] = await f.owner`SELECT relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relname='attendance_not_clocked_in_notices'`;
  expect(flags).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  await f.db.withTenant(b.company, async (tx) => {
    expect(await tx.execute(sql`SELECT id FROM attendance_not_clocked_in_notices`)).toHaveLength(0);
  });
  await expect(
    f.db.withTenant(b.company, (tx) =>
      tx.execute(sql`INSERT INTO attendance_not_clocked_in_notices(company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,alert_due_at,notified_at,recipient_count)
        VALUES(${a.company},${f.ids.newId()},${a.business},${a.branch},${employee},${SHIFT_START},${SHIFT_END},${ALERT_AT},${ALERT_AT},0)`),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(a.company, (tx) =>
      tx.execute(sql`UPDATE attendance_not_clocked_in_notices SET recipient_count=1`),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(a.company, (tx) =>
      tx.execute(sql`DELETE FROM attendance_not_clocked_in_notices`),
    ),
  ).rejects.toThrow();
  const raw = postgres(f.testDb.appUrl, { max: 1, onnotice: () => undefined });
  const auth = postgres(f.testDb.authUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await raw.unsafe('SELECT id FROM attendance_not_clocked_in_notices')).toHaveLength(0);
    await expect(auth.unsafe('SELECT id FROM attendance_not_clocked_in_notices')).rejects.toThrow();
  } finally {
    await raw.end();
    await auth.end();
  }
});

it('the tenant-qualified foreign keys reject a notice aimed at another company employee', async () => {
  const a = await f.tenant();
  const b = await f.tenant();
  const employee = await f.employee(b);
  await expect(
    f.db.withTenant(a.company, (tx) =>
      tx.execute(sql`INSERT INTO attendance_not_clocked_in_notices(company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,alert_due_at,notified_at,recipient_count)
        VALUES(${a.company},${f.ids.newId()},${b.business},${b.branch},${employee},${SHIFT_START},${SHIFT_END},${ALERT_AT},${ALERT_AT},0)`),
    ),
  ).rejects.toThrow();
});
