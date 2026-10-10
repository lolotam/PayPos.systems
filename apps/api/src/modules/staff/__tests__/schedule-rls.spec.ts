import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  schedulesFixture,
  scheduleActor,
  scheduleIds,
  setWeek,
  breakPattern,
  type SchedulesFixture,
} from './schedules.fixture.ts';
let f: SchedulesFixture;
let scheduleId: string;
let templateId: string;
beforeAll(async () => {
  f = await schedulesFixture();
  scheduleId = (await setWeek(f, breakPattern)).id;
  templateId = (
    await f.createTemplate.execute({
      ...scheduleActor(f),
      input: { name_en: 'Synthetic isolated template', shifts: [] },
    })
  ).id;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it.each(['staff_schedules', 'staff_schedule_shifts', 'staff_shift_templates'])(
  'forces RLS and refuses cross-tenant reads/writes for %s',
  async (table) => {
    const flags = await f.h
      .owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=${table}`;
    expect(flags).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const found = await f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(
        sql`SELECT ${table === 'staff_schedule_shifts' ? sql`break_starts_at` : sql`id`} FROM ${sql.identifier(table)} WHERE company_id=${f.company}`,
      ),
    );
    expect(found).toHaveLength(0);
    const updated =
      table === 'staff_schedule_shifts'
        ? await f.db.withTenant(f.otherCompany, (tx) =>
            tx.execute(
              sql`DELETE FROM staff_schedule_shifts WHERE company_id=${f.company} RETURNING id`,
            ),
          )
        : await f.db.withTenant(f.otherCompany, (tx) =>
            tx.execute(
              sql`UPDATE ${sql.identifier(table)} SET revision=revision+1 WHERE company_id=${f.company} RETURNING id`,
            ),
          );
    expect(updated).toHaveLength(0);
  },
);
it('refuses cross-tenant inserts for all three tables and tenant rehoming', async () => {
  await expect(
    f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    VALUES(${f.company},${scheduleIds.newId()},${f.business},${f.branch},${f.employee.id},'2026-11-07','Asia/Kuwait',1)`),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`INSERT INTO staff_shift_templates(company_id,id,business_id,name_en,shifts,revision)
    VALUES(${f.company},${scheduleIds.newId()},${f.business},'Synthetic foreign insert','[]',1)`),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at,break_start,break_end,break_starts_at,break_ends_at)
    VALUES(${f.company},${scheduleIds.newId()},${scheduleId},${f.employee.id},'2026-10-03',0,'18:00','19:00','2026-10-03T15:00Z','2026-10-03T16:00Z','18:15','18:30','2026-10-03T15:15Z','2026-10-03T15:30Z')`),
    ),
  ).rejects.toMatchObject({ cause: { code: '42501' } });
  for (const table of ['staff_schedules', 'staff_shift_templates'])
    await expect(
      f.db.withTenant(f.company, (tx) =>
        tx.execute(
          sql`UPDATE ${sql.identifier(table)} SET company_id=${f.otherCompany} WHERE id=${table === 'staff_schedules' ? scheduleId : templateId}`,
        ),
      ),
    ).rejects.toThrow();
});
it('tenant-qualified FKs refuse foreign parents even under own-tenant INSERT', async () => {
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    VALUES(${f.company},${scheduleIds.newId()},${f.business},${f.foreignBranch},${f.employee.id},'2026-11-07','Asia/Kuwait',1)`),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    VALUES(${f.otherCompany},${scheduleIds.newId()},${scheduleId},${f.employee.id},'2026-10-03',0,'14:00','15:00','2026-10-03T11:00Z','2026-10-03T12:00Z')`),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`INSERT INTO staff_shift_templates(company_id,id,business_id,name_en,shifts,revision)
    VALUES(${f.otherCompany},${scheduleIds.newId()},${f.business},'Synthetic foreign parent','[]',1)`),
    ),
  ).rejects.toThrow();
});
it('without withTenant sees nothing, protected schedule/template deletion and shift mutation are denied', async () => {
  const app = postgres(f.h.urls.app, { max: 1 });
  try {
    for (const table of ['staff_schedules', 'staff_schedule_shifts', 'staff_shift_templates'])
      expect(await app.unsafe(`SELECT id FROM ${table}`)).toHaveLength(0);
  } finally {
    await app.end();
  }
  for (const table of ['staff_schedules', 'staff_shift_templates'])
    await expect(
      f.db.withTenant(f.company, (tx) =>
        tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE company_id=${f.company}`),
      ),
    ).rejects.toThrow();
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`UPDATE staff_schedule_shifts SET day=1 WHERE schedule_id=${scheduleId}`),
    ),
  ).rejects.toThrow();
});
it('cross-tenant upsert cannot update an existing template', async () => {
  await expect(
    f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`INSERT INTO staff_shift_templates(company_id,id,business_id,name_en,shifts,revision)
    VALUES(${f.company},${templateId},${f.business},'Synthetic upsert','[]',1) ON CONFLICT(company_id,id) DO UPDATE SET revision=2`),
    ),
  ).rejects.toThrow();
});
