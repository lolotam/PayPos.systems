import { expect, it } from 'vitest';
import {
  CANCELLATIONS_TABLE,
  TABLES,
  planViolations,
  statementsFor,
  type PlanNode,
  type Planned,
} from './own-service-lines.plans.ts';

const maximum = { names: true, cancelled: true };
const plain = { names: true, cancelled: false };
const scan = (table: string, extra: Partial<PlanNode> = {}): PlanNode => ({
  'Node Type': 'Index Scan',
  'Relation Name': table,
  'Index Cond': '(company_id = $1)',
  'Actual Loops': 1,
  ...extra,
});
const statement = (table: string, extra: Partial<PlanNode> = {}) => ({
  statement: `SELECT 1 FROM ${table}`,
  plan: scan(table, extra),
});
// صفحة بكل جملها: أربع جمل ثابتة على الجداول الثلاثة الأولى + أسماء العملاء، ثم جملة الإلغاءات لو طُلبت.
const page = (withCancellations: boolean, cancellations: Planned = []): Planned => [
  statement('line_performers'),
  statement('service_lines'),
  statement('service_sessions'),
  statement('service_lines'),
  statement('service_sessions'),
  ...(withCancellations ? cancellations : []),
];

it('names the cancellations table in the planned tables', () => {
  expect(TABLES).toContain(CANCELLATIONS_TABLE);
  expect(statementsFor(maximum)).toBe(6);
});

it('accepts a clean plan with and without the cancellations statement', () => {
  expect(planViolations('x', page(false), plain)).toEqual([]);
  expect(planViolations('x', page(true, [statement(CANCELLATIONS_TABLE)]), maximum)).toEqual([]);
});

it('refuses a sequential scan, a repeated scan and a missing company_id on the cancellations table', () => {
  const run = (extra: Partial<PlanNode>) =>
    planViolations('x', page(true, [statement(CANCELLATIONS_TABLE, extra)]), maximum);
  expect(run({ 'Node Type': 'Seq Scan' }).join('|')).toContain('sequential scan');
  expect(run({ 'Actual Loops': 3 }).join('|')).toContain('repeated scan');
  expect(run({ 'Index Cond': '(line_id = ANY ($1))' }).join('|')).toContain('no company_id');
});

it('finds the company_id condition on the index node under a bitmap heap scan', () => {
  const bitmap: PlanNode = {
    'Node Type': 'Bitmap Heap Scan',
    'Relation Name': CANCELLATIONS_TABLE,
    'Actual Loops': 1,
    Plans: [{ 'Node Type': 'Bitmap Index Scan', 'Index Cond': '(company_id = $1)' }],
  };
  const planned = page(true, [{ statement: 'SELECT 1', plan: bitmap }]);
  expect(planViolations('x', planned, maximum)).toEqual([]);
});

it('requires the cancellations statement exactly when the page has a cancelled line', () => {
  expect(planViolations('x', page(false), maximum).join('|')).toContain(
    '0 cancellation statements planned, expected 1',
  );
  const extra = page(true, [statement(CANCELLATIONS_TABLE)]);
  expect(planViolations('x', extra, plain).join('|')).toContain(
    '1 cancellation statements planned, expected 0',
  );
});

it('tolerates a sequential scan or a missing company_id on the analysed small cancellations table, and nowhere else', () => {
  const seq = { 'Node Type': 'Seq Scan', 'Index Cond': '(line_id = ANY ($1))' } as const;
  const tolerated = page(true, [statement(CANCELLATIONS_TABLE, seq)]);
  expect(planViolations('x', tolerated, maximum, { cancellationsAnalysed: true })).toEqual([]);
  expect(planViolations('x', tolerated, maximum, { cancellationsAnalysed: false }).length).toBe(2);
  const other = [
    statement('service_lines', { 'Node Type': 'Seq Scan' }),
    ...page(true, [statement(CANCELLATIONS_TABLE)]).slice(1),
  ];
  expect(planViolations('x', other, maximum, { cancellationsAnalysed: true }).join('|')).toContain(
    'sequential scan',
  );
  const joined = page(true, [statement(CANCELLATIONS_TABLE, { 'Node Type': 'Nested Loop' })]);
  expect(planViolations('x', joined, maximum, { cancellationsAnalysed: true }).join('|')).toContain(
    'join',
  );
});

it('refuses a scan of a protected table whose own index condition has no company_id, in any statement', () => {
  const unscoped = (table: string) =>
    page(false).map((entry) =>
      entry.statement.endsWith(table)
        ? { ...entry, plan: scan(table, { 'Index Cond': '(id = ANY ($1))' }) }
        : entry,
    );
  for (const table of ['line_performers', 'service_lines', 'service_sessions'])
    expect(planViolations('x', unscoped(table), plain).join('|')).toContain(
      `no company_id Index Cond on the ${table} scan`,
    );
});

it('does not take a company_id condition on a sibling node for the protected scan, and checks every bitmap index', () => {
  const bitmap = (conds: string[]): PlanNode => ({
    'Node Type': 'Bitmap Heap Scan',
    'Relation Name': 'service_lines',
    'Actual Loops': 1,
    Plans: conds.map((cond) => ({ 'Node Type': 'Bitmap Index Scan', 'Index Cond': cond })),
  });
  const withPlan = (plan: PlanNode) =>
    page(false).map((entry) =>
      entry.statement.endsWith('service_lines') ? { ...entry, plan } : entry,
    );
  const sibling: PlanNode = {
    'Node Type': 'Aggregate',
    Plans: [scan('line_performers'), bitmap(['(id = ANY ($1))'])],
  };
  expect(planViolations('x', withPlan(sibling), plain).join('|')).toContain(
    'no company_id Index Cond on the service_lines scan',
  );
  expect(
    planViolations('x', withPlan(bitmap(['(company_id = $1)', '(id = $2)'])), plain).join('|'),
  ).toContain('no company_id Index Cond on the service_lines scan');
  expect(
    planViolations('x', withPlan(bitmap(['(company_id = $1)', '(company_id = $1)'])), plain),
  ).toEqual([]);
});
