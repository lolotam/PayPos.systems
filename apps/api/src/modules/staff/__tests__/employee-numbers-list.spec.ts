import { employeeNumberListItem, employeeNumberPage } from '@pospay/contracts';
import type { EmployeeNumberListQuery } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeListSearch } from '../persistence/employee-list-search.ts';
import {
  listEmployeeNumbers,
  listEmployeeNumbersStatement,
  type EmployeeNumberSearch,
} from '../queries/list-employee-numbers.query.ts';
import { employeeNumberIds, executeCreate } from './employee-number-assign.fixture.ts';
import {
  attachBranch,
  clearNumberGrants,
  grantNumber,
  numberDevice,
  numberFixture,
} from './set-employee-number.fixture.ts';

const FIELDS = [
  'business_id',
  'business_name_ar',
  'business_name_en',
  'employee_id',
  'employee_number',
  'name_ar',
  'name_en',
].sort();
let f: Awaited<ReturnType<typeof numberFixture>>;
let ownerUserId: string;

beforeAll(async () => {
  f = await numberFixture();
  const [owner] = await f.h.owner`SELECT id FROM "user" WHERE email='employee-owner@example.test'`;
  ownerUserId = owner?.['id'] as string;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

async function pageOf(cookie: string, params: Record<string, string>) {
  const res = await f.h.send('GET', `/v1/employee-numbers?${new URLSearchParams(params)}`, {
    cookie,
    company: f.company,
  });
  if (res.status !== 200) throw new Error(`LIST_${res.status}_${String(res.body['code'])}`);
  return employeeNumberPage.parse(res.body);
}

async function ids(cookie: string, q: string) {
  return (await pageOf(cookie, { q, limit: '100' })).items.map((row) => row.employee_id);
}

async function asHolder() {
  await clearNumberGrants(f);
  await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
}

it('EN-16 returns only the seven fields for both businesses', async () => {
  const first = await executeCreate(f, 'EN16 both A');
  const second = await executeCreate(f, 'EN16 both B', {
    businessId: f.secondBusiness,
    branchId: f.otherBranch,
  });
  await f.h.owner`UPDATE employees SET name_ar='كلا الاسمين' WHERE company_id=${f.company} AND id=${first.id}`;
  const page = await pageOf(f.ownerCookie, { q: 'EN16 both', limit: '20' });
  expect(page.items.map((row) => row.employee_id).sort()).toEqual([first.id, second.id].sort());
  const row = page.items.find((item) => item.employee_id === first.id);
  expect(Object.keys(row ?? {}).sort()).toEqual(FIELDS);
  expect(row).toEqual({
    employee_id: first.id,
    name_ar: 'كلا الاسمين',
    name_en: 'EN16 both A',
    business_id: f.business,
    business_name_ar: null,
    business_name_en: 'Synthetic business',
    employee_number: first.employee_number,
  });
  expect(employeeNumberListItem.safeParse({ ...row, salary_mills: 1 }).success).toBe(false);
});

it('omits a soft-deleted employee and keeps a null number', async () => {
  const live = await executeCreate(f, 'EN16 null number');
  const gone = await executeCreate(f, 'EN16 deleted number');
  await f.h.owner`UPDATE employees SET employee_number=NULL WHERE company_id=${f.company} AND id=${live.id}`;
  await f.h.owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${gone.id}`;
  expect(await pageOf(f.ownerCookie, { q: 'EN16 null', limit: '20' })).toMatchObject({
    items: [{ employee_id: live.id, employee_number: null }],
    next_cursor: null,
  });
  expect(await ids(f.ownerCookie, 'EN16 deleted')).toEqual([]);
});

it('a non-holder and a device get 403', async () => {
  await clearNumberGrants(f);
  const refused = await f.h.send('GET', '/v1/employee-numbers', { cookie: f.cookie, company: f.company });
  expect(refused.status).toBe(403);
  expect(refused.body['code']).toBe('FORBIDDEN');
  const token = await numberDevice(f);
  const device = await f.h.app.inject({
    method: 'GET',
    url: '/v1/employee-numbers',
    headers: { authorization: `Device ${token}`, 'x-company-id': f.company, origin: 'http://admin.test' },
  });
  expect(device.statusCode).toBe(403);
});

it('a business DENY hides that business only', async () => {
  const blocked = await executeCreate(f, 'EN16 deny business');
  const allowed = await executeCreate(f, 'EN16 deny business other', {
    businessId: f.secondBusiness,
    branchId: f.otherBranch,
  });
  await asHolder();
  await grantNumber(f, 'DENY', 'BUSINESS', f.business);
  try {
    expect(await ids(f.cookie, 'EN16 deny business')).toEqual([allowed.id]);
    expect(blocked.id).not.toBe(allowed.id);
  } finally {
    await clearNumberGrants(f);
  }
});

it('a primary-branch DENY hides her after the attachment ends', async () => {
  const employee = await executeCreate(f, 'EN16 deny primary');
  const other = await executeCreate(f, 'EN16 deny primary other', {
    businessId: f.secondBusiness,
    branchId: f.otherBranch,
  });
  await asHolder();
  await grantNumber(f, 'DENY', 'BRANCH', f.branch);
  try {
    expect(await ids(f.cookie, 'EN16 deny primary')).toEqual([other.id]);
    await f.h.owner`UPDATE employee_branches SET "to"='2026-01-02'
      WHERE company_id=${f.company} AND employee_id=${employee.id} AND branch_id=${f.branch}`;
    expect(await ids(f.cookie, 'EN16 deny primary')).toEqual([other.id]);
  } finally {
    await clearNumberGrants(f);
  }
});

it('a DENY on a current attachment hides her, including one that starts in the future', async () => {
  const current = await executeCreate(f, 'EN16 deny current');
  const future = await executeCreate(f, 'EN16 deny future');
  const extra = await attachBranch(f, current.id);
  const later = employeeNumberIds.newId();
  await f.h.owner`INSERT INTO branches (company_id,id,business_id,name_en)
    VALUES (${f.company},${later},${f.business},'Synthetic future')`;
  await f.h.owner`INSERT INTO employee_branches (company_id,id,business_id,employee_id,branch_id,"from")
    VALUES (${f.company},${employeeNumberIds.newId()},${f.business},${future.id},${later},'2099-01-01')`;
  await asHolder();
  await grantNumber(f, 'DENY', 'BRANCH', extra);
  await grantNumber(f, 'DENY', 'BRANCH', later);
  try {
    expect(await ids(f.cookie, 'EN16 deny current')).toEqual([]);
    expect(await ids(f.cookie, 'EN16 deny future')).toEqual([]);
  } finally {
    await clearNumberGrants(f);
  }
});

it('a DENY on an attachment that ends today does not hide her', async () => {
  const employee = await executeCreate(f, 'EN16 deny ended');
  const branchId = await attachBranch(f, employee.id);
  await f.h.owner`UPDATE employee_branches SET "to"=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kuwait')::date
    WHERE company_id=${f.company} AND employee_id=${employee.id} AND branch_id=${branchId}`;
  await asHolder();
  await grantNumber(f, 'DENY', 'BRANCH', branchId);
  try {
    expect(await ids(f.cookie, 'EN16 deny ended')).toEqual([employee.id]);
  } finally {
    await clearNumberGrants(f);
  }
});

it('a DENY on an attachment that ended yesterday still lists the employee', async () => {
  const employee = await executeCreate(f, 'EN16 deny yesterday');
  const branchId = await attachBranch(f, employee.id);
  await f.h.owner`UPDATE employee_branches SET "to"=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kuwait')::date - 1
    WHERE company_id=${f.company} AND employee_id=${employee.id} AND branch_id=${branchId}`;
  await asHolder();
  await grantNumber(f, 'DENY', 'BRANCH', branchId);
  try {
    expect(await ids(f.cookie, 'EN16 deny yesterday')).toEqual([employee.id]);
  } finally {
    await clearNumberGrants(f);
  }
});

it('an owner still sees the employee when her own membership has a business DENY', async () => {
  const employee = await executeCreate(f, 'EN16 owner deny');
  const [membership] = await f.h.owner`SELECT m.id FROM memberships m JOIN "user" u ON u.id=m.user_id
    WHERE m.company_id=${f.company} AND u.email='employee-owner@example.test'`;
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${employeeNumberIds.newId()},${membership?.['id'] as string},
      'manage:employee-number:company','DENY','BUSINESS',${f.business},'Synthetic owner deny',${f.userId})`;
  try {
    expect(await ids(f.ownerCookie, 'EN16 owner deny')).toEqual([employee.id]);
  } finally {
    await clearNumberGrants(f);
  }
});

it('q matches digits as an exact number or a name, and letters in either language', async () => {
  const numbered = await executeCreate(f, 'EN16 digit plain');
  const named = await executeCreate(f, 'EN16 880061 named');
  const other = await executeCreate(f, 'EN16 digit other');
  const arabic = await executeCreate(f, 'EN16 arabic holder');
  await f.h.owner`UPDATE employees SET employee_number=880061 WHERE company_id=${f.company} AND id=${numbered.id}`;
  await f.h.owner`UPDATE employees SET employee_number=880062 WHERE company_id=${f.company} AND id=${other.id}`;
  await f.h.owner`UPDATE employees SET name_ar='بحثالأرقام' WHERE company_id=${f.company} AND id=${arabic.id}`;
  expect((await ids(f.ownerCookie, '880061')).sort()).toEqual([numbered.id, named.id].sort());
  expect(await ids(f.ownerCookie, '00880061')).toEqual([numbered.id]);
  expect(await ids(f.ownerCookie, '880062')).toEqual([other.id]);
  expect(await ids(f.ownerCookie, 'بحثالأرقام')).toEqual([arabic.id]);
  expect(await ids(f.ownerCookie, 'en16 arabic')).toEqual([arabic.id]);
});

it('cursor pages are stable and a denied row is skipped before the cursor', async () => {
  const rows = [
    await executeCreate(f, 'QzxPage a'),
    await executeCreate(f, 'QzxPage b'),
    await executeCreate(f, 'QzxPage c'),
  ];
  const first = await pageOf(f.ownerCookie, { q: 'QzxPage', limit: '2' });
  expect(first.items.map((row) => row.employee_id)).toEqual([rows[0]?.id, rows[1]?.id]);
  expect(first.next_cursor).toBe(rows[1]?.id);
  const last = await pageOf(f.ownerCookie, { q: 'QzxPage', limit: '2', cursor: first.next_cursor ?? '' });
  expect(last.items.map((row) => row.employee_id)).toEqual([rows[2]?.id]);
  expect(last.next_cursor).toBeNull();
  const extra = await attachBranch(f, rows[1]?.id ?? '');
  await asHolder();
  await grantNumber(f, 'DENY', 'BRANCH', extra);
  try {
    const hidden = await pageOf(f.cookie, { q: 'QzxPage', limit: '1' });
    expect(hidden.items.map((row) => row.employee_id)).toEqual([rows[0]?.id]);
    const next = await pageOf(f.cookie, { q: 'QzxPage', limit: '1', cursor: rows[0]?.id ?? '' });
    expect(next.items.map((row) => row.employee_id)).toEqual([rows[2]?.id]);
    expect(next.next_cursor).toBeNull();
  } finally {
    await clearNumberGrants(f);
  }
});

it('rejects an empty, overlong, or unknown query and a disabled staff feature', async () => {
  const send = (query: string) =>
    f.h.send('GET', `/v1/employee-numbers?${query}`, { cookie: f.ownerCookie, company: f.company });
  expect((await send('q=')).status).toBe(400);
  expect((await send(`q=${'a'.repeat(101)}`)).status).toBe(400);
  expect((await send('limit=101')).status).toBe(400);
  expect((await send('employee_number=1')).status).toBe(400);
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${f.company},'staff',false,'Synthetic disabled',${f.userId})`;
  try {
    expect((await send('limit=20')).body['code']).toBe('FEATURE_DISABLED');
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  }
});

it('parses the result shape and the plan does not seq-scan employees', async () => {
  const employee = await executeCreate(f, 'EN16 shape');
  const page = await f.db.withTenant(f.company, (tx) =>
    listEmployeeNumbers(
      tx,
      f.company,
      ownerUserId,
      { limit: 20, q: 'EN16 shape' },
      employeeListSearch('EN16 shape'),
    ),
  );
  expect(employeeNumberPage.parse(page).items.map((row) => row.employee_id)).toEqual([employee.id]);
  const digit = await planFor({ limit: 20, q: '0880007' }, employeeListSearch('0880007'));
  const letters = await planFor({ limit: 20, q: 'Synthetic' }, employeeListSearch('Synthetic'));
  expect(JSON.stringify(digit)).toContain('employees_company_employee_number_key');
  expect(explainNodes(digit).some((node) => node['Relation Name'] === 'employees')).toBe(true);
  expect(scansEmployees(digit)).toBe(false);
  expect(scansEmployees(letters)).toBe(false);
});

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

async function planFor(query: EmployeeNumberListQuery, search: EmployeeNumberSearch | undefined) {
  return f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${listEmployeeNumbersStatement(f.company, ownerUserId, query, search)}`,
    );
  });
}

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
