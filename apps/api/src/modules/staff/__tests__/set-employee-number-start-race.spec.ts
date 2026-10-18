import { employeeNumbering } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeNumberingStatement, readEmployeeNumbering } from '../queries/employee-numbering.query.ts';
import { executeCreate, provisionEmployer, setCounter } from './employee-number-assign.fixture.ts';
import {
  ALREADY_SET,
  counterOf,
  numberFixture,
  numbersOf,
  putStart,
  startAudits,
  type EmployeeFixture,
} from './set-employee-number-start.fixture.ts';

let f: EmployeeFixture;
beforeAll(async () => {
  f = await numberFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
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
  const empty = await provisionEmployer(f, 'EN-11 empty counter');
  const [missing] = await f.h.owner`SELECT company_id FROM employee_number_sequences WHERE company_id=${empty.companyId}`;
  expect(missing).toBeUndefined();
  const caught = await f.db
    .withTenant(f.company, (tx) =>
      tx.execute(sql`INSERT INTO employee_number_sequences(company_id) VALUES (${empty.companyId})`),
    )
    .then(
      () => null,
      (error: unknown) => error,
    );
  const refused = databaseRefusal(caught);
  expect(refused.code).toBe('42501');
  expect(refused.message).toMatch(/row-level security/);
  const [created] = await f.h.owner`SELECT company_id FROM employee_number_sequences WHERE company_id=${empty.companyId}`;
  expect(created).toBeUndefined();
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
  const row = await counterOf(f, employer.companyId);
  expect(row?.start_number).toBe(1000);
  expect(row?.next_number).toBe(created.employee_number === 4 ? 1000 : 1001);
  expect(await numbersOf(f, employer.companyId)).toEqual([created.employee_number]);
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

function databaseRefusal(error: unknown): { code: string; message: string } {
  const seen = new Set<unknown>();
  let code = '';
  const messages: string[] = [];
  for (
    let current: unknown = error;
    typeof current === 'object' && current !== null && !seen.has(current);
    current = (current as { cause?: unknown }).cause
  ) {
    seen.add(current);
    const node = current as { code?: unknown; message?: unknown };
    if (code === '' && node.code !== undefined) code = String(node.code);
    if (typeof node.message === 'string') messages.push(node.message);
  }
  return { code, message: messages.join('\n') };
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
