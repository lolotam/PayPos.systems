import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';

import {
  employeeImportFixture,
  employeeWorkbook,
  previewCommand,
  type EmployeeImportFixture,
} from './employee-import.fixture.ts';

const ids = systemUuidV7();
let f: EmployeeImportFixture;
let previewId: string;
beforeAll(async () => {
  f = await employeeImportFixture();
  previewId = (await f.preview.execute(previewCommand(f, await f.upload(await employeeWorkbook([
    ['RLS employee', null, 'staff', '2026-01-01', null, 'Main'],
  ]))))).preview_id;
});
afterAll(async () => {
  await f?.h.close();
});

const other = systemUuidV7().newId();
const asOther = (statement: ReturnType<typeof sql>) =>
  f.db.withTenant(other, (tx) => tx.execute(statement));
const asOwnCompany = (statement: ReturnType<typeof sql>) =>
  f.db.withTenant(f.company, (tx) => tx.execute(statement));

it('FORCE RLS hides the preview from another tenant and refuses cross-tenant inserts', async () => {
  expect(await asOther(sql`SELECT id FROM import_previews WHERE id=${previewId}`)).toHaveLength(0);
  expect(
    await asOther(sql`UPDATE import_previews SET committed_at=now() WHERE id=${previewId} RETURNING id`),
  ).toHaveLength(0);
  await expect(
    asOther(sql`INSERT INTO import_previews
      (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors)
      VALUES (${f.company},${ids.newId()},${f.business},'employees',${ids.newId()},${f.userId},now(),now()+interval '1 day',0,0,'[]'::jsonb,'[]'::jsonb)`),
  ).rejects.toThrow();
});

it('runtime may only consume a preview, never delete, re-home or rewrite its rows', async () => {
  for (const statement of [
    sql`DELETE FROM import_previews WHERE id=${previewId}`,
    sql`UPDATE import_previews SET rows='[]'::jsonb WHERE id=${previewId}`,
    sql`UPDATE import_previews SET company_id=${other} WHERE id=${previewId}`,
    sql`UPDATE import_previews SET business_id=${f.secondBusiness} WHERE id=${previewId}`,
  ])
    await expect(asOwnCompany(statement)).rejects.toThrow();
  const [table] = await f.h.owner`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='import_previews'`;
  expect([table?.['relrowsecurity'], table?.['relforcerowsecurity']]).toEqual([true, true]);
});
