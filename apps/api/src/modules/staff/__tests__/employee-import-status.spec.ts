import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { employeeImportStatusQuery } from '../queries/employee-import-status.query.ts';
import {
  employeeImportFixture,
  employeeWorkbook,
  previewCommand,
  seedImportPlanRows,
  type EmployeeImportFixture,
} from './employee-import.fixture.ts';

let f: EmployeeImportFixture;
beforeAll(async () => {
  f = await employeeImportFixture();
});
afterAll(async () => {
  await f?.h.close();
});

it('returns API 202, identical replay, and creator-only status through to committed', async () => {
  const preview = await f.preview.execute(
    previewCommand(
      f,
      await f.upload(
        await employeeWorkbook([['Status employee', null, 'staff', '2026-01-01', null, 'Main']]),
      ),
    ),
  );
  const cookie = f.managerCookie;
  const route = `/v1/businesses/${f.business}/employees/import/commits`;
  const command = {
    cookie,
    company: f.company,
    key: 'status-request',
    body: { preview_id: preview.preview_id },
  };
  const first = await f.h.send('POST', route, command);
  expect(first.status).toBe(202);
  expect(first.body).toEqual({ preview_id: preview.preview_id });
  expect(await f.h.send('POST', route, command)).toMatchObject({ status: 202, body: first.body });
  const read = () =>
    f.h.send(
      'GET',
      `/v1/businesses/${f.business}/employees/import/previews/${preview.preview_id}`,
      { cookie, company: f.company },
    );
  expect(await read()).toMatchObject({
    status: 200,
    body: { status: 'commit_requested', created_count: 0, error_code: null },
  });
  await f.worker.execute(f.company, preview.preview_id);
  expect(await read()).toMatchObject({
    status: 200,
    body: { status: 'committed', created_count: 1 },
  });
});

it('another user, tenant, business and unknown preview all receive the same unknown refusal', async () => {
  const preview = await f.preview.execute(
    previewCommand(
      f,
      await f.upload(
        await employeeWorkbook([['Private status', null, 'staff', '2026-01-01', null, 'Main']]),
      ),
    ),
  );
  const ids = systemUuidV7();
  for (const [company, user, business, id] of [
    [f.company, ids.newId(), f.business, preview.preview_id],
    [ids.newId(), f.userId, f.business, preview.preview_id],
    [f.company, f.userId, f.secondBusiness, preview.preview_id],
    [f.company, f.userId, f.business, ids.newId()],
  ] as const) {
    await expect(
      employeeImportStatusQuery(f.db, company, user, business, id),
    ).rejects.toMatchObject({ code: 'IMPORT_PREVIEW_NOT_FOUND' });
  }
});

it('uses the tenant-qualified primary key for the exact status read statement', async () => {
  await seedImportPlanRows(f);
  const plan = await f.h
    .owner`EXPLAIN ANALYZE SELECT id AS preview_id,status,created_count,error_code FROM import_previews
    WHERE company_id=${f.company} AND business_id=${f.business} AND created_by=${f.userId}
      AND id=${systemUuidV7().newId()} AND entity='employees'`;
  expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toMatch(/import_previews_pkey/);
});
