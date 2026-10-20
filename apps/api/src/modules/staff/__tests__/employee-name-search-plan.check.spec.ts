import { expect, it } from 'vitest';
import {
  PLAN_PROBLEMS,
  tenantBoundProblems,
  type PlanNode,
} from './employee-name-search-plan.check.ts';

// اختبارات الفاحص نفسه: مخططات مكتوبة باليد بلا داتابيز، عشان الفاحص ما يعدّيش وهو
// بيفشل صامت. كل حالة سليمة ترجّع فاضية، وكل حالة خربانة ترجّع مشكلة مسمّاة.

const TENANT_COND = '(e.company_id = 1 AND e.business_id = 2)';
const COMPANY_ONLY_COND = '(e.company_id = 1)';
const NAME_PREDICATE = '(lower(e.name_ar) ~~ lower(e.name_en))';
const NAME_FILTER = `(e.deleted_at IS NULL AND ${NAME_PREDICATE})`;
const ALLOWED_ROWS = 7;

const indexScan = (overrides: Partial<PlanNode> = {}): PlanNode[] => [
  {
    'Node Type': 'Index Scan',
    'Relation Name': 'employees',
    'Index Name': 'employees_company_business_id_idx',
    'Index Cond': TENANT_COND,
    Filter: NAME_FILTER,
    'Actual Rows': 3,
    'Actual Loops': 1,
    'Rows Removed by Filter': 4,
    ...overrides,
  },
];

const bitmapIndexScan = (cond: string, overrides: Partial<PlanNode> = {}): PlanNode => ({
  'Node Type': 'Bitmap Index Scan',
  'Index Name': 'employees_company_business_id_idx',
  'Index Cond': cond,
  'Actual Rows': 7,
  'Actual Loops': 1,
  ...overrides,
});

const bitmapHeap = (bitmap: PlanNode, overrides: Partial<PlanNode> = {}): PlanNode[] => [
  {
    'Node Type': 'Bitmap Heap Scan',
    'Relation Name': 'employees',
    Filter: NAME_FILTER,
    'Actual Rows': 3,
    'Actual Loops': 1,
    'Rows Removed by Filter': 4,
    'Rows Removed by Index Recheck': 0,
    Plans: [bitmap],
    ...overrides,
  },
];

const ACCEPT: { name: string; plan: PlanNode[] }[] = [
  { name: 'an index scan bounded by the tenant keys', plan: indexScan() },
  {
    name: 'a bitmap heap scan whose bitmap index scan carries the tenant keys',
    plan: bitmapHeap(bitmapIndexScan(TENANT_COND)),
  },
  {
    name: 'a bitmap and of a bound and an unbound branch',
    plan: bitmapHeap({
      'Node Type': 'BitmapAnd',
      Plans: [bitmapIndexScan(TENANT_COND), bitmapIndexScan(COMPANY_ONLY_COND)],
    }),
  },
  {
    name: 'an index scan on the name key index with both tenant keys',
    plan: indexScan({ 'Index Name': 'employees_company_business_name_en_key_idx' }),
  },
  {
    name: 'an index scan on the name key index with a prefix condition on the key column',
    plan: indexScan({
      'Index Name': 'employees_company_business_name_en_key_idx',
      'Index Cond': `(e.company_id = 1 AND e.business_id = 2 AND e.name_en_key >= 'sar'::text)`,
    }),
  },
];

const REJECT: { name: string; plan: PlanNode[]; problem: string }[] = [
  {
    name: 'a plan without an employees node',
    plan: [
      {
        'Node Type': 'Index Scan',
        'Relation Name': 'employee_branches',
        'Index Name': 'employee_branches_company_employee_from_idx',
        'Index Cond': '(eb.company_id = 1)',
        'Actual Rows': 1,
        'Actual Loops': 1,
      },
    ],
    problem: PLAN_PROBLEMS.noEmployees,
  },
  {
    name: 'a sequential scan on employees',
    plan: [
      {
        'Node Type': 'Seq Scan',
        'Relation Name': 'employees',
        Filter: NAME_FILTER,
        'Actual Rows': 3,
        'Actual Loops': 1,
        'Rows Removed by Filter': 4000,
      },
    ],
    problem: PLAN_PROBLEMS.sequentialScan,
  },
  {
    name: 'an employees access that is not an index access',
    plan: [
      {
        'Node Type': 'Tid Scan',
        'Relation Name': 'employees',
        Filter: NAME_FILTER,
        'Actual Rows': 3,
        'Actual Loops': 1,
      },
    ],
    problem: PLAN_PROBLEMS.noIndexAccess,
  },
  {
    name: 'a tenant key moved from the index condition to the filter',
    plan: indexScan({
      'Index Cond': '(e.business_id = 2)',
      Filter: `(e.company_id = 1 AND ${NAME_PREDICATE})`,
    }),
    problem: PLAN_PROBLEMS.unboundTenant,
  },
  {
    name: 'a bitmap or with a branch that lacks the business key',
    plan: bitmapHeap({
      'Node Type': 'BitmapOr',
      Plans: [bitmapIndexScan(TENANT_COND), bitmapIndexScan(COMPANY_ONLY_COND)],
    }),
    problem: PLAN_PROBLEMS.unboundTenant,
  },
  {
    name: 'a name predicate inside an index condition',
    plan: indexScan({
      'Index Cond': `(e.company_id = 1 AND e.business_id = 2 AND ${NAME_PREDICATE})`,
    }),
    problem: PLAN_PROBLEMS.nameInIndexCond,
  },
  {
    name: 'a name predicate missing from the filter',
    plan: indexScan({ Filter: '(e.deleted_at IS NULL)' }),
    problem: PLAN_PROBLEMS.nameNotFilter,
  },
  {
    name: 'a node that read more rows than the business holds',
    plan: indexScan({ 'Rows Removed by Filter': 4000 }),
    problem: PLAN_PROBLEMS.tooManyRows,
  },
  {
    name: 'a bitmap and whose unbound branch read more rows than the business holds',
    plan: bitmapHeap({
      'Node Type': 'BitmapAnd',
      Plans: [
        bitmapIndexScan(TENANT_COND),
        bitmapIndexScan(COMPANY_ONLY_COND, { 'Actual Rows': 4000 }),
      ],
    }),
    problem: PLAN_PROBLEMS.tooManyRows,
  },
];

it.each(ACCEPT)('the plan checker accepts $name', ({ plan }) => {
  expect(tenantBoundProblems(plan, ALLOWED_ROWS)).toEqual([]);
});

it.each(REJECT)('the plan checker rejects $name', ({ plan, problem }) => {
  expect(tenantBoundProblems(plan, ALLOWED_ROWS)).toContain(problem);
});
