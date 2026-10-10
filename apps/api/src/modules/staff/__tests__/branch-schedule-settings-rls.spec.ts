import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { schedulesFixture, type SchedulesFixture } from './schedules.fixture.ts';

let f: SchedulesFixture;
beforeAll(async () => {
  f = await schedulesFixture();
  await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`INSERT INTO staff_branch_schedule_settings
    (company_id,business_id,branch_id,max_shifts_per_day,updated_by,updated_at)
    VALUES(${f.company},${f.business},${f.branch},3,${f.userId},now())`),
  );
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('forces RLS and hides foreign reads, updates and deletes', async () => {
  expect(
    await f.h
      .owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='staff_branch_schedule_settings'`,
  ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  for (const statement of [
    sql`SELECT * FROM staff_branch_schedule_settings`,
    sql`UPDATE staff_branch_schedule_settings SET max_shifts_per_day=4 RETURNING branch_id`,
    sql`DELETE FROM staff_branch_schedule_settings RETURNING branch_id`,
  ])
    expect(await f.db.withTenant(f.otherCompany, (tx) => tx.execute(statement))).toHaveLength(0);
});
it('refuses foreign inserts/upserts and tenant or business mismatched branch FKs', async () => {
  for (const [tenant, company, business, branch] of [
    [f.otherCompany, f.company, f.business, f.branch],
    [f.otherCompany, f.otherCompany, f.business, f.branch],
    [f.company, f.company, f.secondBusiness, f.secondBranch],
  ] as const)
    await expect(
      f.db.withTenant(tenant, (tx) =>
        tx.execute(sql`INSERT INTO staff_branch_schedule_settings
      (company_id,business_id,branch_id,max_shifts_per_day,updated_by,updated_at)
      VALUES(${company},${business},${branch},4,${f.userId},now())
      ON CONFLICT(company_id,branch_id) DO UPDATE SET max_shifts_per_day=4`),
      ),
    ).rejects.toThrow();
});
it('denies identity-column updates and unscoped reads', async () => {
  for (const statement of [
    sql`UPDATE staff_branch_schedule_settings SET company_id=${f.otherCompany}`,
    sql`UPDATE staff_branch_schedule_settings SET branch_id=${f.secondBranch}`,
    sql`UPDATE staff_branch_schedule_settings SET business_id=${f.secondBusiness}`,
  ] as const)
    await expect(f.db.withTenant(f.company, (tx) => tx.execute(statement))).rejects.toThrow();
  const app = postgres(f.h.urls.app, { max: 1 });
  try {
    expect(await app`SELECT * FROM staff_branch_schedule_settings`).toHaveLength(0);
  } finally {
    await app.end();
  }
});
it.each([0, 5])('enforces range %s in PostgreSQL', async (value) => {
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`UPDATE staff_branch_schedule_settings SET max_shifts_per_day=${value}`),
    ),
  ).rejects.toThrow();
});
