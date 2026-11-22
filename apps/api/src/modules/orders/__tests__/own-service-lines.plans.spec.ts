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
