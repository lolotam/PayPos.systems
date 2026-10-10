import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { SHIFT_END, SHIFT_START, type Tenant } from './not-clocked-in.fixture.ts';
import {
  BREAK_ALERT_AT,
  BREAK_END,
  BREAK_OUT,
  breakNotReturnedFixture,
  type BreakNotReturnedFixture,
} from './break-not-returned.fixture.ts';

let f: BreakNotReturnedFixture;
beforeAll(async () => {
  f = await breakNotReturnedFixture();
});
afterAll(async () => {
  await f?.close();
});

const insert = (target: Tenant, owner: Tenant, employee: string, id: string, breakEnd = BREAK_END) =>
  sql`INSERT INTO attendance_break_not_returned_notices(company_id,id,business_id,branch_id,employee_id,
      shift_starts_at,shift_ends_at,break_ends_at,break_out_at,alert_due_at,notified_at,recipient_count)
    VALUES(${target.company},${id},${owner.business},${owner.branch},${employee},${SHIFT_START.toISOString()},
      ${SHIFT_END.toISOString()},${breakEnd.toISOString()},${BREAK_OUT.toISOString()},
      ${BREAK_ALERT_AT.toISOString()},${BREAK_ALERT_AT.toISOString()},0)`;

it('attendance_break_not_returned_notices enforces FORCE RLS and refuses cross-tenant reads and writes', async () => {
  const a = await f.tenant();
  const b = await f.tenant();
  const employee = await f.employee(a);
  await f.db.withTenant(a.company, (tx) => tx.execute(insert(a, a, employee, f.ids.newId())));
  const [flags] = await f.owner`SELECT relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relname='attendance_break_not_returned_notices'`;
  expect(flags).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  await f.db.withTenant(b.company, async (tx) => {
    expect(await tx.execute(sql`SELECT id FROM attendance_break_not_returned_notices`)).toHaveLength(0);
  });
  await expect(
    f.db.withTenant(b.company, (tx) => tx.execute(insert(a, a, employee, f.ids.newId()))),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(a.company, (tx) =>
      tx.execute(sql`UPDATE attendance_break_not_returned_notices SET recipient_count=1`),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(a.company, (tx) => tx.execute(sql`DELETE FROM attendance_break_not_returned_notices`)),
  ).rejects.toThrow();
  const raw = postgres(f.testDb.appUrl, { max: 1, onnotice: () => undefined });
  const auth = postgres(f.testDb.authUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await raw.unsafe('SELECT id FROM attendance_break_not_returned_notices')).toHaveLength(0);
    await expect(auth.unsafe('SELECT id FROM attendance_break_not_returned_notices')).rejects.toThrow();
  } finally {
    await raw.end();
    await auth.end();
  }
});

it('rejects a notice aimed at another company employee, a duplicate shift, and a break end outside the shift', async () => {
  const a = await f.tenant();
  const b = await f.tenant();
  const foreign = await f.employee(b);
  await expect(
    f.db.withTenant(a.company, (tx) => tx.execute(insert(a, b, foreign, f.ids.newId()))),
  ).rejects.toThrow();
  const employee = await f.employee(a);
  await f.db.withTenant(a.company, (tx) => tx.execute(insert(a, a, employee, f.ids.newId())));
  await expect(
    f.db.withTenant(a.company, (tx) => tx.execute(insert(a, a, employee, f.ids.newId()))),
  ).rejects.toThrow();
  const other = await f.employee(a);
  await expect(
    f.db.withTenant(a.company, (tx) => tx.execute(insert(a, a, other, f.ids.newId(), SHIFT_END))),
  ).rejects.toThrow();
});
