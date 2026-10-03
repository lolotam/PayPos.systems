import { employeeListItem, employeePage } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { listEmployees, listEmployeesStatement } from '../queries/list-employees.query.ts';
import { createEmployeeDetailAccess } from '../persistence/employee-detail-access.adapter.ts';
import { employeeDetail } from '../queries/employee-detail.query.ts';
import {
  createForUpdate,
  executeUpdate,
  updateEmployeeFixture,
  employeeGrants,
  ids,
  type UpdateFixture,
} from './update-employee.fixture.ts';
let f: UpdateFixture;
let records: Awaited<ReturnType<typeof createForUpdate>>[];
beforeAll(async () => {
  f = await updateEmployeeFixture();
  records = [
    await createForUpdate(f, { name_en: 'Synthetic A' }),
    await createForUpdate(f, { name_en: 'Synthetic B' }),
    await createForUpdate(f, { name_en: 'Synthetic C' }),
  ];
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const list = (limit: number, cursor?: string, company = f.company, business = f.business) =>
  f.db.withTenant(company, (tx) =>
    listEmployees(
      tx,
      company,
      business,
      f.userId,
      { limit, ...(cursor ? { cursor } : {}) },
      createEmployeeDetailAccess(),
    ),
  );
it('UE-08 returns exact projections and stable cursor pages with no duplicate rows', async () => {
  const first = employeePage.parse(await list(2));
  expect(first.items).toEqual(records.slice(0, 2).map((record) => employeeListItem.parse(record)));
  expect(first.next_cursor).toBe(records[1]?.id);
  const last = employeePage.parse(await list(2, first.next_cursor ?? undefined));
  expect(last).toEqual({ items: [employeeListItem.parse(records[2])], next_cursor: null });
  expect(await list(2, ids.newId())).toEqual({ items: [], next_cursor: null });
});
it('details include sorted active branches and revision; list query uses both scope and attachment indexes', async () => {
  const record = records[0];
  if (!record) throw new Error('Missing synthetic fixture');
  const changed = await executeUpdate(f, record, { branch_ids: [f.sibling, f.branch] });
  const detail = await f.db.withTenant(f.company, (tx) =>
    employeeDetail(tx, f.company, f.business, record.id, f.userId, createEmployeeDetailAccess()),
  );
  expect(detail).toEqual(changed);
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${listEmployeesStatement(f.company, f.business, { limit: 20 }, [f.branch, f.sibling])}`,
    );
  });
  expect(JSON.stringify(plan)).toMatch(/employees_company_business_id_(idx|key)/);
  expect(JSON.stringify(plan)).toContain('employee_branches_active_key');
});
it('DENY on any active branch filters before paging; cursors reference visible rows only', async () => {
  await employeeGrants(f, [
    ['ALLOW', 'BUSINESS', f.business],
    ['DENY', 'BRANCH', f.sibling],
  ]);
  const first = await list(1);
  expect(first).toEqual({
    items: [employeeListItem.parse(records[1])],
    next_cursor: records[1]?.id,
  });
  const second = employeePage.parse(await list(1, records[1]?.id));
  expect(second).toEqual({ items: [employeeListItem.parse(records[2])], next_cursor: null });
  await employeeGrants(f, [['ALLOW', 'BRANCH', f.branch]]);
  expect(employeePage.parse(await list(20)).items.map((r) => r.id)).toEqual(
    records.slice(1).map((r) => r.id),
  );
  await employeeGrants(f, [['ALLOW', 'BUSINESS', f.business]]);
});
it('collection access is company/business scoped and soft-deleted rows stay hidden', async () => {
  expect(await list(20, undefined, f.otherCompany)).toEqual({ items: [], next_cursor: null });
  expect(await list(20, undefined, f.company, f.secondBusiness)).toEqual({
    items: [],
    next_cursor: null,
  });
  await f.h.owner`UPDATE employees SET deleted_at=now() WHERE id=${records[2]?.id as string}`;
  expect(employeePage.parse(await list(20)).items).toHaveLength(2);
});
it('HTTP list is guarded, validates limits, checks the feature, and issues one staff projection', async () => {
  const path = `/v1/businesses/${f.business}/employees`;
  expect((await f.h.app.inject({ method: 'GET', url: path })).statusCode).toBe(401);
  const count = f.h.calls.statements.length;
  expect(
    (await f.h.send('GET', `${path}?limit=20`, { cookie: f.cookie, company: f.company })).status,
  ).toBe(200);
  expect(
    f.h.calls.statements.slice(count).filter((q) => q.sql.includes('FROM employees e')),
  ).toHaveLength(1);
  expect(
    (await f.h.send('GET', `${path}?limit=101`, { cookie: f.cookie, company: f.company })).status,
  ).toBe(400);
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES (${f.company},'staff',false,'Synthetic disabled',${f.userId})`;
  try {
    expect(
      (await f.h.send('GET', path, { cookie: f.cookie, company: f.company })).body['code'],
    ).toBe('FEATURE_DISABLED');
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  }
});
