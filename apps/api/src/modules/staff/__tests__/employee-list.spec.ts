import { employeeListItem, employeePage } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeListSearch } from '../persistence/employee-list-search.ts';
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
  q?: string,
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
        ...(q === undefined ? {} : { q }),
      },
      createEmployeeDetailAccess(),
      employeeListSearch(q),
    ),
  );
const search = (q: string, limit = 20, cursor?: string, employeeNumber?: number) =>
  list(limit, cursor, f.company, f.business, employeeNumber, q);
async function insertListed(nameEn: string, employeeNumber: number, nameAr: string | null = null) {
  const id = ids.newId();
  await f.h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_ar,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${f.company},${id},${f.business},${f.branch},${nameAr},${nameEn},${nameEn.toLowerCase()},'staff','2026-01-01',${employeeNumber})`;
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.company},${ids.newId()},${f.business},${id},${f.branch},'2026-01-01')`;
  return id;
}
async function releaseListed(id: string) {
  await f.h.owner`UPDATE employees SET deleted_at=now(),employee_number=NULL WHERE company_id=${f.company} AND id=${id}`;
}
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
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${listEmployeesStatement(f.company, f.business, { limit: 20 }, [f.branch, f.sibling], undefined)}`,
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
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${listEmployeesStatement(f.company, f.business, { limit: 20, employee_number: number }, [f.branch, f.sibling], undefined)}`,
    );
  });
  expect(JSON.stringify(plan)).toContain('employees_company_employee_number_key');
});
const idsOf = async (q: string, limit = 20, cursor?: string, employeeNumber?: number) =>
  employeePage.parse(await search(q, limit, cursor, employeeNumber)).items.map((row) => row.id);
it('EN-Q16 digit q matches the exact number and a name containing those digits', async () => {
  const numbered = await insertListed('Plain digit', 880001);
  const named = await insertListed('Desk 880001', 880002);
  const padded = await insertListed('Padded digit', 880007);
  try {
    expect((await idsOf('880001')).sort()).toEqual([named, numbered].sort());
    expect(await idsOf('0880007')).toEqual([padded]);
    expect(await search('880009')).toEqual({ items: [], next_cursor: null });
    await f.h.owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${numbered}`;
    expect(await idsOf('880001')).toEqual([named]);
  } finally {
    await releaseListed(numbered);
    await releaseListed(named);
    await releaseListed(padded);
  }
});
it('EN-Q16 letter q matches Arabic and English names and does not treat letters as a number', async () => {
  const english = await insertListed('Heba Lister', 880011);
  const arabic = await insertListed('Other Person', 880012, 'هبة القايمة');
  const percent = await insertListed('100% pure', 880013);
  const underscore = await insertListed('A_B token', 880014);
  const plain = await insertListed('Plain mixed', 880041);
  const mixed = await insertListed('Note 880041x', 880042);
  try {
    expect(await idsOf('heba')).toEqual([english]);
    expect(await idsOf('هبة')).toEqual([arabic]);
    expect(await idsOf('%')).toEqual([percent]);
    expect(await idsOf('_')).toEqual([underscore]);
    expect(await idsOf('880041x')).toEqual([mixed]);
    expect(await search('zzzz-no-such')).toEqual({ items: [], next_cursor: null });
  } finally {
    for (const id of [english, arabic, percent, underscore, plain, mixed]) await releaseListed(id);
  }
});
it('EN-Q16 q combines with the exact number filter and with paging', async () => {
  const alpha = await insertListed('Alpha 880021', 880021);
  const beta = await insertListed('Beta 880021', 880022);
  try {
    expect(await idsOf('880021', 20, undefined, 880022)).toEqual([beta]);
    expect(await idsOf('880021', 20, undefined, 880021)).toEqual([alpha]);
    const first = employeePage.parse(await search('880021', 1));
    expect(first.items).toHaveLength(1);
    expect(first.next_cursor).toBe(first.items[0]?.id);
    const second = employeePage.parse(await search('880021', 1, first.next_cursor ?? undefined));
    expect(second.next_cursor).toBeNull();
    expect([first.items[0]?.id, second.items[0]?.id].sort()).toEqual([alpha, beta].sort());
  } finally {
    await releaseListed(alpha);
    await releaseListed(beta);
  }
});
it('EN-Q16 q never returns an employee hidden by a branch DENY', async () => {
  const hidden = await insertListed('Hidden 880031', 880031);
  try {
    expect(await idsOf('880031')).toEqual([hidden]);
    await employeeGrants(f, [
      ['ALLOW', 'BUSINESS', f.business],
      ['DENY', 'BRANCH', f.branch],
    ]);
    expect(await search('880031')).toEqual({ items: [], next_cursor: null });
  } finally {
    await employeeGrants(f, [['ALLOW', 'BUSINESS', f.business]]);
    await releaseListed(hidden);
  }
});
it('EN-Q16 q hides an allowed-primary employee currently attached to a denied branch', async () => {
  const id = await insertListed('Split 880051', 880051);
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.company},${ids.newId()},${f.business},${id},${f.sibling},'2026-01-01')`;
  try {
    expect(await idsOf('880051')).toEqual([id]);
    await employeeGrants(f, [
      ['ALLOW', 'BUSINESS', f.business],
      ['DENY', 'BRANCH', f.sibling],
    ]);
    expect(await search('880051')).toEqual({ items: [], next_cursor: null });
  } finally {
    await employeeGrants(f, [['ALLOW', 'BUSINESS', f.business]]);
    await releaseListed(id);
  }
});
it('HTTP rejects an empty or overlong q and accepts a short one', async () => {
  const path = `/v1/businesses/${f.business}/employees`;
  const send = (query: string) => f.h.send('GET', `${path}?${query}`, { cookie: f.cookie, company: f.company });
  expect((await send('q=')).status).toBe(400);
  expect((await send(`q=${'a'.repeat(101)}`)).status).toBe(400);
  expect((await send('q=a')).status).toBe(200);
});
interface ExplainNode {
  'Node Type'?: string;
  'Relation Name'?: string;
}
function explainNodes(value: unknown): ExplainNode[] {
  const parsed = typeof value === 'string' && (value[0] === '{' || value[0] === '[') ? parsedPlan(value) : value;
  if (parsed === null || typeof parsed !== 'object') return [];
  if (Array.isArray(parsed)) return parsed.flatMap(explainNodes);
  const record = parsed as Record<string, unknown>;
  const nodeType = record['Node Type'];
  const relation = record['Relation Name'];
  const self: ExplainNode[] =
    typeof nodeType === 'string'
      ? [{ 'Node Type': nodeType, ...(typeof relation === 'string' ? { 'Relation Name': relation } : {}) }]
      : [];
  return [
    ...self,
    ...explainNodes(record['QUERY PLAN']),
    ...explainNodes(record['Plan']),
    ...explainNodes(record['Plans']),
    ...explainNodes(record['InitPlan']),
  ];
}
function parsedPlan(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
const scansEmployees = (plan: unknown) =>
  explainNodes(plan).some((node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'employees');
it('flags a nested Seq Scan on employees inside an EXPLAIN plan', () => {
  expect(
    scansEmployees([
      {
        'QUERY PLAN': [
          {
            Plan: {
              'Node Type': 'Limit',
              Plans: [
                {
                  'Node Type': 'Index Scan',
                  'Relation Name': 'employees',
                  Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'employees' }],
                },
              ],
            },
          },
        ],
      },
    ]),
  ).toBe(true);
});
it('EXPLAIN uses the number key for a digit q and the existing list index for a name q', async () => {
  const planFor = async (q: string) =>
    f.db.withTenant(f.company, async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan=off`);
      return tx.execute(
        sql`EXPLAIN (ANALYZE,FORMAT JSON) ${listEmployeesStatement(f.company, f.business, { limit: 20, q }, [f.branch, f.sibling], employeeListSearch(q))}`,
      );
    });
  const digit = await planFor('0880007');
  expect(JSON.stringify(digit)).toContain('employees_company_employee_number_key');
  const letters = await planFor('Synthetic');
  // enable_seqscan=off يثبت أن فهرس القائمة ممكن الوصول، لا أنه اختيار المخطط الافتراضي.
  expect(JSON.stringify(letters)).toMatch(/employees_company_business_id_(idx|key)/);
  expect(explainNodes(digit).some((node) => node['Relation Name'] === 'employees')).toBe(true);
  expect(scansEmployees(digit)).toBe(false);
  expect(scansEmployees(letters)).toBe(false);
});
