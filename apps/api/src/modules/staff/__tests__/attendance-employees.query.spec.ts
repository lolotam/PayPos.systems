import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceEmployeePage, attendanceEmployeesQuery } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import {
  attendanceEmployees,
  attendanceEmployeesStatement,
} from '../queries/attendance-employees.query.ts';
import {
  attendanceEmployeesFixture,
  type AttendanceEmployeesFixture,
} from './attendance-employees.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: AttendanceEmployeesFixture;
beforeAll(async () => {
  f = await attendanceEmployeesFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const list = (query: Record<string, unknown> = {}) =>
  f.db.withTenant(f.company, (tx) =>
    attendanceEmployees(tx, f.scope, f.boardClock.now(), attendanceEmployeesQuery.parse(query)),
  );

it('projects only names and id through the shared currentAttachment definition, independently of primary branch', async () => {
  const page = attendanceEmployeePage.parse(await list({ search: 'Picker' }));
  expect(page.items).toHaveLength(f.expected.length);
  expect(page.items).toEqual(expect.arrayContaining(f.expected));
  for (const row of page.items)
    expect(Object.keys(row).sort()).toEqual(['id', 'name_ar', 'name_en']);
  expect(page.next_cursor).toBeNull();
  expect((await list()).items.some((row) => row.id === f.employee.id)).toBe(true);
});
it('matches either name case-insensitively and treats SQL wildcard characters literally', async () => {
  expect((await list({ search: '  pIcKeR bEtA  ' })).items).toHaveLength(2);
  expect((await list({ search: 'ألف' })).items).toEqual([
    f.expected.find((e) => e.name_en === 'Picker Alpha'),
  ]);
  expect((await list({ search: '%_' })).items).toEqual([
    f.expected.find((e) => e.name_en.includes('%_')),
  ]);
  expect((await list({ search: "' OR true --" })).items).toEqual([]);
  expect(await list({ search: '' })).toEqual(await list());
});
it('paginates by name then id through ties and punctuation, with no duplicate employees from multiple current links', async () => {
  const all = (await list({ search: 'Picker' })).items;
  const seen = [];
  let cursor: string | null = null;
  do {
    const page = await list({ search: 'Picker', limit: 1, ...(cursor ? { cursor } : {}) });
    seen.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  expect(seen).toEqual(all);
  expect(new Set(seen.map((e) => e.id)).size).toBe(f.expected.length);
  const tied = all.filter((e) => e.name_en === 'Picker Beta');
  expect(tied.map((e) => e.id)).toEqual(tied.map((e) => e.id).sort());
  expect(all.map((e) => e.name_en)).toEqual(all.map((e) => e.name_en).sort());
});
it('RLS hides the tenant employees and links even if the query names the foreign tenant', async () => {
  await f.db.withTenant(f.otherCompany, async (tx) => {
    expect(await attendanceEmployees(tx, f.scope, f.boardClock.now(), { limit: 50 })).toEqual({
      items: [],
      next_cursor: null,
    });
    for (const table of ['employees', 'employee_branches'])
      expect(
        await tx.execute(
          sql`SELECT id FROM ${sql.identifier(table)} WHERE company_id=${f.company}`,
        ),
      ).toHaveLength(0);
  });
});
it('EXPLAIN ANALYZE bounds name matching to indexed branch links without scanning the business employee directory', async () => {
  const ids = Array.from({ length: 3000 }, () => leaveIds.newId());
  const links = ids.map(() => leaveIds.newId());
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    SELECT ${f.company},id,${f.business},${f.secondBranch},'Synthetic load '||id,'synthetic load '||id,'staff','2026-01-01'
    FROM unnest(${ids}::uuid[]) AS id`;
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    SELECT ${f.company},link,${f.business},employee,${f.secondBranch},'2026-01-01'
    FROM unnest(${links}::uuid[],${ids}::uuid[]) AS rows(link,employee)`;
  await f.h.owner`ANALYZE employees`;
  await f.h.owner`ANALYZE employee_branches`;
  await f.db.withTenant(f.company, async (tx) => {
    for (const query of [
      { limit: 50 },
      { limit: 50, search: 'Picker' },
      { limit: 1, search: 'ألف', cursor: JSON.stringify(['Picker', f.employee.id]) },
    ]) {
      const plan = await tx.execute(
        sql`EXPLAIN (ANALYZE,FORMAT JSON) ${attendanceEmployeesStatement(f.scope, f.boardClock.now(), query)}`,
      );
      const encoded = JSON.stringify(plan);
      expect(encoded).toContain('employee_branches_company_branch_from_idx');
      expect(encoded).toContain('CTE Scan');
      expect(encoded).toMatch(/employees_(pkey|company_business_id_idx|company_business_id_key)/);
      expect(encoded).not.toMatch(/"Node Type":"Seq Scan",".*?"Relation Name":"employees"/);
    }
  });
});
