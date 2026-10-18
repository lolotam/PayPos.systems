import { employeeNumbering } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeNumberingStatement, readEmployeeNumbering } from '../queries/employee-numbering.query.ts';
import {
  executeCreate,
  insertHeldNumbers,
  provisionEmployer,
  readCounter,
  setCounter,
  type EmployeeFixture,
} from './employee-number-assign.fixture.ts';
import { clearNumberGrants, grantNumber, numberDevice, numberFixture } from './set-employee-number.fixture.ts';

const ALREADY_SET = {
  code: 'EMPLOYEE_NUMBER_START_ALREADY_SET',
  message_en: 'The starting number was already chosen once and cannot be changed.',
  message_ar: 'رقم بداية الترقيم حُدّد مرة واحدة ولا يمكن تغييره.',
};

let f: EmployeeFixture;
beforeAll(async () => {
  f = await numberFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('EN-11 keeps 1, 2 and 3, then assigns 1000 to the next employee', async () => {
  const employer = await provisionEmployer(f, 'EN-11 forward');
  await insertHeldNumbers(f, 1, 3, employer);
  await setCounter(f, 4, employer.companyId);
  const set = await putStart(f, { start_number: 1000 }, { company: employer.companyId });
  expect(set.status).toBe(200);
  expect(employeeNumbering.parse(set.body)).toMatchObject({
    next_number: 1000,
    start_number: 1000,
    can_manage: false,
  });
  expect(await numbersOf(f, employer.companyId)).toEqual([1, 2, 3]);
  const created = await executeCreate(f, 'EN-11 next', employer);
  expect(created.employee_number).toBe(1000);
  expect(await numbersOf(f, employer.companyId)).toEqual([1, 2, 3, 1000]);
  expect(await startAudits(f, employer.companyId)).toEqual([
    {
      entity_id: employer.companyId,
      actor_user_id: f.userId,
      before: { start_number: null, next_number: 4 },
      after: { start_number: 1000, next_number: 1000 },
    },
  ]);
});

it('EN-11 gives the first employee of an empty company the chosen start', async () => {
  const employer = await provisionEmployer(f, 'EN-11 empty');
  const before = await getNumbering(f, { company: employer.companyId });
  expect(employeeNumbering.parse(before.body)).toEqual({
    next_number: 1,
    start_number: null,
    start_set_at: null,
    can_manage: true,
  });
  expect((await putStart(f, { start_number: 1000 }, { company: employer.companyId })).status).toBe(200);
  const created = await executeCreate(f, 'EN-11 first', employer);
  expect(created.employee_number).toBe(1000);
});

it('EN-11 rejects a second start and leaves the row and the audit alone', async () => {
  const employer = await provisionEmployer(f, 'EN-11 once');
  expect((await putStart(f, { start_number: 1000 }, { company: employer.companyId })).status).toBe(200);
  const before = await counterOf(f, employer.companyId);
  const second = await putStart(f, { start_number: 2000 }, { company: employer.companyId });
  expect(second.status).toBe(409);
  expect(second.body).toMatchObject(ALREADY_SET);
  expect(await counterOf(f, employer.companyId)).toEqual(before);
  expect(await startAudits(f, employer.companyId)).toHaveLength(1);
});

it('EN-11 records a start below the counter without lowering it', async () => {
  const employer = await provisionEmployer(f, 'EN-11 lower');
  await setCounter(f, 4, employer.companyId);
  const set = await putStart(f, { start_number: 2 }, { company: employer.companyId });
  expect(employeeNumbering.parse(set.body)).toMatchObject({ next_number: 4, start_number: 2, can_manage: false });
  const created = await executeCreate(f, 'EN-11 stays', employer);
  expect(created.employee_number).toBe(4);
});

it('EN-11 numbers from 1 when no start was chosen', async () => {
  const employer = await provisionEmployer(f, 'EN-11 default');
  const created = await executeCreate(f, 'EN-11 one', employer);
  expect(created.employee_number).toBe(1);
  const view = await getNumbering(f, { company: employer.companyId });
  expect(employeeNumbering.parse(view.body)).toMatchObject({
    next_number: 2,
    start_number: null,
    start_set_at: null,
    can_manage: true,
  });
});

it('allows the owner and a granted person, and refuses everyone else', async () => {
  expect((await putStart(f, { start_number: 10 })).status).toBe(403);
  expect((await getNumbering(f)).status).toBe(403);
  const device = await devicePut(f, await numberDevice(f), { start_number: 11 });
  expect(device.status).toBe(403);
  await withoutStaff(f, async () => {
    const disabled = await putStart(f, { start_number: 12 }, { cookie: f.ownerCookie });
    expect(disabled.body['code']).toBe('FEATURE_DISABLED');
  });
  expect(await readCounter(f)).toBeNull();
  const ownerCompany = await f.h.onboard(f.ownerCookie, 'EN-11 owner');
  const owner = await putStart(f, { start_number: 40 }, { cookie: f.ownerCookie, company: ownerCompany });
  expect(owner.status).toBe(200);
  await expectOwnerAudit(f, ownerCompany, owner.body);
  await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
  try {
    const granted = await putStart(f, { start_number: 70 });
    expect(granted.status).toBe(200);
    expect(employeeNumbering.parse(granted.body).can_manage).toBe(false);
  } finally {
    await clearNumberGrants(f);
  }
});

it('rejects a start outside 1..999999 and unknown keys', async () => {
  const companyId = await f.h.onboard(f.ownerCookie, 'EN-11 body');
  for (const body of [{ start_number: 0 }, { start_number: 1_000_000 }, { start_number: 1.5 }, { start_number: 3, extra: true }]) {
    expect((await putStart(f, body, { cookie: f.ownerCookie, company: companyId })).status).toBe(400);
  }
  expect(await readCounter(f, companyId)).toBeNull();
});

it('never reads or writes another tenant counter', async () => {
  await f.h.owner`INSERT INTO employee_number_sequences
    (company_id, next_number, start_number, start_set_by, start_set_at, updated_at)
    VALUES (${f.otherCompany}, 77, 50, ${f.userId}, now(), now())`;
  const hidden = await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`SELECT next_number FROM employee_number_sequences WHERE company_id=${f.otherCompany}`),
  );
  expect(hidden).toHaveLength(0);
  const updated = await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`UPDATE employee_number_sequences SET next_number=88 WHERE company_id=${f.otherCompany} RETURNING company_id`),
  );
  expect(updated).toHaveLength(0);
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`INSERT INTO employee_number_sequences(company_id) VALUES (${f.otherCompany})`),
    ),
  ).rejects.toThrow();
  const [still] = await f.h.owner`SELECT next_number, start_number FROM employee_number_sequences WHERE company_id=${f.otherCompany}`;
  expect(Number(still?.['next_number'])).toBe(77);
  expect(Number(still?.['start_number'])).toBe(50);
});

it('lets exactly one of two concurrent starts win', async () => {
  const employer = await provisionEmployer(f, 'EN-11 race put');
  const [left, right] = await Promise.all([
    putStart(f, { start_number: 1000 }, { company: employer.companyId }),
    putStart(f, { start_number: 2000 }, { company: employer.companyId }),
  ]);
  expect([left.status, right.status].sort()).toEqual([200, 409]);
  expect((left.status === 409 ? left : right).body).toMatchObject(ALREADY_SET);
  const winner = left.status === 200 ? 1000 : 2000;
  expect(await counterOf(f, employer.companyId)).toMatchObject({ next_number: winner, start_number: winner });
  expect(await startAudits(f, employer.companyId)).toHaveLength(1);
});

it('keeps numbers unique when a start races an automatic create', async () => {
  const employer = await provisionEmployer(f, 'EN-11 race create');
  await setCounter(f, 4, employer.companyId);
  const [set, created] = await Promise.all([
    putStart(f, { start_number: 1000 }, { company: employer.companyId }),
    executeCreate(f, 'EN-11 raced', employer),
  ]);
  expect(set.status).toBe(200);
  expect(created.employee_number === 4 || created.employee_number === 1000).toBe(true);
  expect(await numbersOf(f, employer.companyId)).toEqual([created.employee_number]);
  const row = await counterOf(f, employer.companyId);
  expect(row?.start_number).toBe(1000);
  expect(row?.next_number).toBe(created.employee_number === 4 ? 1000 : 1001);
});

it('parses the numbering shape and does not seq-scan the counter', async () => {
  const employer = await provisionEmployer(f, 'EN-11 plan');
  const shape = await f.db.withTenant(employer.companyId, (tx) => readEmployeeNumbering(tx, employer.companyId));
  expect(employeeNumbering.parse(shape)).toEqual({
    next_number: 1,
    start_number: null,
    start_set_at: null,
    can_manage: true,
  });
  const plan = await f.db.withTenant(employer.companyId, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${employeeNumberingStatement(employer.companyId)}`);
  });
  expect(explainNodes(plan).some((node) => node['Relation Name'] === 'employee_number_sequences')).toBe(true);
  expect(scansSequences(plan)).toBe(false);
});

it('flags a nested Seq Scan on employee_number_sequences', () => {
  expect(
    scansSequences([
      {
        Plan: {
          'Node Type': 'Index Scan',
          'Relation Name': 'employee_number_sequences',
          Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'employee_number_sequences' }],
        },
      },
    ]),
  ).toBe(true);
});

async function putStart(
  fixture: EmployeeFixture,
  body: object,
  options: { cookie?: string; company?: string } = {},
) {
  const response = await fixture.h.app.inject({
    method: 'PUT',
    url: '/v1/employee-numbering/start',
    headers: {
      cookie: options.cookie ?? fixture.cookie,
      'x-company-id': options.company ?? fixture.company,
      origin: 'http://admin.test',
    },
    payload: body,
  });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

function getNumbering(fixture: EmployeeFixture, options: { cookie?: string; company?: string } = {}) {
  return fixture.h.send('GET', '/v1/employee-numbering', {
    cookie: options.cookie ?? fixture.cookie,
    company: options.company ?? fixture.company,
  });
}

async function devicePut(fixture: EmployeeFixture, token: string, body: object) {
  const response = await fixture.h.app.inject({
    method: 'PUT',
    url: '/v1/employee-numbering/start',
    payload: body,
    headers: { authorization: `Device ${token}`, 'x-company-id': fixture.company, origin: 'http://admin.test' },
  });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

async function withoutStaff(fixture: EmployeeFixture, work: () => Promise<void>) {
  await fixture.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${fixture.company},'staff',false,'Synthetic disabled',${fixture.userId})`;
  try {
    await work();
  } finally {
    await fixture.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${fixture.company} AND flag='staff'`;
  }
}

async function expectOwnerAudit(fixture: EmployeeFixture, companyId: string, body: Record<string, unknown>) {
  const setAt = Date.parse(String(body['start_set_at']));
  expect(Math.abs(Date.now() - setAt)).toBeLessThan(60_000);
  const [owner] = await fixture.h.owner`SELECT id FROM "user" WHERE email='employee-owner@example.test'`;
  const row = await counterOf(fixture, companyId);
  expect(row).toMatchObject({ next_number: 40, start_number: 40, start_set_by: owner?.['id'], start_set_at: body['start_set_at'] });
  const again = await getNumbering(fixture, { cookie: fixture.ownerCookie, company: companyId });
  expect(again.body).toEqual(body);
}

function storedInstant(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

async function counterOf(fixture: EmployeeFixture, companyId: string) {
  const [row] = await fixture.h.owner<Record<string, unknown>[]>`
    SELECT next_number, start_number, start_set_by, start_set_at
    FROM employee_number_sequences WHERE company_id=${companyId}`;
  if (row === undefined) return null;
  return {
    next_number: Number(row['next_number']),
    start_number: row['start_number'] === null ? null : Number(row['start_number']),
    start_set_by: row['start_set_by'],
    start_set_at: storedInstant(row['start_set_at']),
  };
}

function startAudits(fixture: EmployeeFixture, companyId: string) {
  return fixture.h.owner<{ entity_id: string; actor_user_id: string; before: unknown; after: unknown }[]>`
    SELECT entity_id, actor_user_id, before, after FROM audit_log
    WHERE company_id=${companyId} AND entity='employee_number_sequences' AND action='employee_number.start_set'`;
}

async function numbersOf(fixture: EmployeeFixture, companyId: string) {
  const rows = await fixture.h.owner<{ employee_number: number | string }[]>`
    SELECT employee_number FROM employees WHERE company_id=${companyId} ORDER BY employee_number`;
  return rows.map((row) => Number(row.employee_number));
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

const scansSequences = (plan: unknown) =>
  explainNodes(plan).some(
    (node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'employee_number_sequences',
  );
