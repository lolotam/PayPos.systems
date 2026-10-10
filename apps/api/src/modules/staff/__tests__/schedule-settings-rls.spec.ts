import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { schedulesFixture, type SchedulesFixture } from './schedules.fixture.ts';
let f: SchedulesFixture;
beforeAll(async () => {
  f = await schedulesFixture();
  await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`INSERT INTO staff_schedule_settings
    (company_id,business_id,max_shifts_per_day,updated_by,updated_at)
    VALUES(${f.company},${f.business},3,${f.userId},now())`),
  );
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('forces RLS and hides foreign reads and updates', async () => {
  expect(
    await f.h
      .owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='staff_schedule_settings'`,
  ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  expect(
    await f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`SELECT * FROM staff_schedule_settings`),
    ),
  ).toHaveLength(0);
  expect(
    await f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(
        sql`UPDATE staff_schedule_settings SET max_shifts_per_day=4 RETURNING business_id`,
      ),
    ),
  ).toHaveLength(0);
});
it('rejects foreign inserts, upserts, tenant rehoming and foreign business FKs', async () => {
  for (const company of [f.company, f.otherCompany]) {
    await expect(
      f.db.withTenant(f.otherCompany, (tx) =>
        tx.execute(sql`INSERT INTO staff_schedule_settings
      (company_id,business_id,max_shifts_per_day,updated_by,updated_at)
      VALUES(${company},${f.business},4,${f.userId},now()) ON CONFLICT(company_id,business_id) DO UPDATE SET max_shifts_per_day=4`),
      ),
    ).rejects.toThrow();
  }
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`UPDATE staff_schedule_settings SET company_id=${f.otherCompany}`),
    ),
  ).rejects.toThrow();
});
it('denies deletion and unscoped reads', async () => {
  await expect(
    f.db.withTenant(f.company, (tx) => tx.execute(sql`DELETE FROM staff_schedule_settings`)),
  ).rejects.toThrow();
  const app = postgres(f.h.urls.app, { max: 1 });
  try {
    expect(await app`SELECT * FROM staff_schedule_settings`).toHaveLength(0);
  } finally {
    await app.end();
  }
});
it.each([0, 5])('enforces the range in PostgreSQL: %s', async (value) => {
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`UPDATE staff_schedule_settings SET max_shifts_per_day=${value}`),
    ),
  ).rejects.toThrow();
});
