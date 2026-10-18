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
// الاختبار بيحوّل سجل كامل لشكل عنصر القائمة بالمفاتيح اللي السكيما بتعرفها، لأن عقود الرد strict في اختبارات الـ API (ADR-0047) ومش بتشيل مفتاح زيادة.
const listItem = (record: object | undefined) => {
  if (!record) throw new Error('Missing synthetic fixture');
  const source = record as Record<string, unknown>;
  return employeeListItem.parse(
    Object.fromEntries(Object.keys(employeeListItem.shape).map((key) => [key, source[key]])),
  );
};
const list = (
  limit: number,
  cursor?: string,
  company = f.company,
  business = f.business,
  employeeNumber?: number,
) =>
  f.db.withTenant(company, (tx) =>
    listEmployees(
      tx,
      company,
      business,
      f.userId,
      {
        limit,
        ...(cursor ? { cursor } : {}),
        ...(employeeNumber === undefined ? {} : { employee_number: employeeNumber }),
      },
      createEmployeeDetailAccess(),
    ),
  );
it('UE-08 returns exact projections and stable cursor pages with no duplicate rows', async () => {
  const first = employeePage.parse(await list(2));
  expect(first.items).toEqual(records.slice(0, 2).map((record) => listItem(record)));
  expect(first.next_cursor).toBe(records[1]?.id);
  const last = employeePage.parse(await list(2, first.next_cursor ?? undefined));
  expect(last).toEqual({ items: [listItem(records[2])], next_cursor: null });
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
  // فهرس الارتباط المفتوح وحده لا يغطي نهاية مستقبلية؛ يظل فحص النطاق مفهرساً على الشركة والموظفة.
  expect(JSON.stringify(plan)).toMatch(/employee_branches_(company_employee_from_idx|no_overlap)/);
});
it('DENY on any active branch filters before paging; cursors reference visible rows only', async () => {
  await employeeGrants(f, [
    ['ALLOW', 'BUSINESS', f.business],
    ['DENY', 'BRANCH', f.sibling],
  ]);
  const first = await list(1);
  expect(first).toEqual({
    items: [listItem(records[1])],
    next_cursor: records[1]?.id,
  });
  const second = employeePage.parse(await list(1, records[1]?.id));
  expect(second).toEqual({ items: [listItem(records[2])], next_cursor: null });
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
it('list and detail keep a null employee number on the contract shape', async () => {
  const record = records[1];
  if (record?.employee_number == null) throw new Error('missing employee number');
  await f.h.owner`UPDATE employees SET employee_number=NULL WHERE company_id=${f.company} AND id=${record.id}`;
  try {
    const page = employeePage.parse(await list(20));
    expect(page.items.find((row) => row.id === record.id)?.employee_number).toBeNull();
    const detail = await f.db.withTenant(f.company, (tx) =>
      employeeDetail(tx, f.company, f.business, record.id, f.userId, createEmployeeDetailAccess()),
    );
    expect(detail).toMatchObject({ id: record.id, employee_number: null });
  } finally {
    await f.h
      .owner`UPDATE employees SET employee_number=${record.employee_number} WHERE company_id=${f.company} AND id=${record.id}`;
  }
});
it('EN-14 list filter returns exactly that employee and an empty page outside its scope', async () => {
  const record = records[1];
  if (record?.employee_number == null) throw new Error('missing employee number');
  const number = record.employee_number;
  expect(
    employeePage.parse(await list(20, undefined, f.company, f.business, number)).items.map((row) => row.id),
  ).toEqual([record.id]);
  expect(await list(20, record.id, f.company, f.business, number)).toEqual({ items: [], next_cursor: null });
  expect(await list(20, undefined, f.company, f.secondBusiness, number)).toEqual({ items: [], next_cursor: null });
  expect(await list(20, undefined, f.otherCompany, f.foreignBusiness, number)).toEqual({
    items: [],
    next_cursor: null,
  });
});
it('EN-14 list filter hides the same number in another company and a deleted employee', async () => {
  const record = records[1];
  if (record?.employee_number == null) throw new Error('missing employee number');
  const number = record.employee_number;
  const foreign = ids.newId();
  await f.h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${f.otherCompany},${foreign},${f.foreignBusiness},${f.foreignBranch},'Foreign number','foreign number','staff','2026-01-01',${number})`;
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.otherCompany},${ids.newId()},${f.foreignBusiness},${foreign},${f.foreignBranch},'2026-01-01')`;
  try {
    expect(
      employeePage.parse(await list(20, undefined, f.company, f.business, number)).items.map((row) => row.id),
    ).toEqual([record.id]);
    await f.h.owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${record.id}`;
    expect(await list(20, undefined, f.company, f.business, number)).toEqual({ items: [], next_cursor: null });
  } finally {
    await f.h.owner`UPDATE employees SET deleted_at=NULL WHERE company_id=${f.company} AND id=${record.id}`;
    await f.h.owner`UPDATE employees SET deleted_at=now(),employee_number=NULL WHERE company_id=${f.otherCompany} AND id=${foreign}`;
  }
});
it('EN-14 list filter hides the numbered employee when their branch is forbidden', async () => {
  const record = records[1];
  if (record?.employee_number == null) throw new Error('missing employee number');
  await employeeGrants(f, [
    ['ALLOW', 'BUSINESS', f.business],
    ['DENY', 'BRANCH', f.branch],
  ]);
  try {
    expect(await list(20, undefined, f.company, f.business, record.employee_number)).toEqual({
      items: [],
      next_cursor: null,
    });
  } finally {
    await employeeGrants(f, [['ALLOW', 'BUSINESS', f.business]]);
  }
});
it('HTTP rejects a non-number filter and returns the one exact employee', async () => {
  const record = records[1];
  if (record?.employee_number == null) throw new Error('missing employee number');
  const path = `/v1/businesses/${f.business}/employees`;
  const send = (query: string) => f.h.send('GET', `${path}?${query}`, { cookie: f.cookie, company: f.company });
  for (const value of ['0', '1000000', 'abc', '1.5']) expect((await send(`employee_number=${value}`)).status).toBe(400);
  const found = await send(`employee_number=${record.employee_number}`);
  expect(found.status).toBe(200);
  expect(found.body).toMatchObject({ items: [{ id: record.id, employee_number: record.employee_number }], next_cursor: null });
});
it('EXPLAIN uses employees_company_employee_number_key for the exact list filter', async () => {
  const number = records[1]?.employee_number;
  if (number == null) throw new Error('missing employee number');
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${listEmployeesStatement(f.company, f.business, { limit: 20, employee_number: number }, [f.branch, f.sibling])}`,
    );
  });
  expect(JSON.stringify(plan)).toContain('employees_company_employee_number_key');
});
