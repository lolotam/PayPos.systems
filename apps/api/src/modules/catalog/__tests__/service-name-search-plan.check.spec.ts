import { expect, it } from 'vitest';
import {
  PLAN_PROBLEMS,
  tenantBoundProblems,
  type PlanNode,
} from './service-name-search-plan.check.ts';

// اختبارات الفاحص نفسه: مخططات مكتوبة باليد بلا داتابيز، عشان الفاحص ما يعدّيش وهو
// بيفشل صامت. كل حالة سليمة ترجّع فاضية، وكل حالة خربانة ترجّع مشكلة مسمّاة.

const TENANT_COND = '(s.company_id = 1 AND s.business_id = 2)';
const COMPANY_ONLY_COND = '(s.company_id = 1)';
const NAME_PREDICATE = `(lower(s.name_ar COLLATE "und-x-icu") LIKE '%sara%' OR lower(s.name_en COLLATE "und-x-icu") LIKE '%sara%')`;
const NAME_FILTER = `(s.closed_at IS NULL AND ${NAME_PREDICATE})`;
const ALLOWED_ROWS = 7;

const indexScan = (overrides: Partial<PlanNode> = {}): PlanNode[] => [
  {
    'Node Type': 'Index Scan',
    'Relation Name': 'services',
    'Index Name': 'services_company_business_id_key',
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
  'Index Name': 'services_company_business_id_key',
  'Index Cond': cond,
  'Actual Rows': 7,
  'Actual Loops': 1,
  ...overrides,
});

const bitmapHeap = (bitmap: PlanNode, overrides: Partial<PlanNode> = {}): PlanNode[] => [
  {
    'Node Type': 'Bitmap Heap Scan',
    'Relation Name': 'services',
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
];

const REJECT: { name: string; plan: PlanNode[]; problem: string }[] = [
  {
    name: 'a plan without a services node',
    plan: [
      {
        'Node Type': 'Index Scan',
        'Relation Name': 'service_categories',
        'Index Name': 'service_categories_business_name_uq',
        'Index Cond': '(c.business_id = 2)',
        'Actual Rows': 1,
        'Actual Loops': 1,
      },
    ],
    problem: PLAN_PROBLEMS.noServices,
  },
  {
    name: 'a sequential scan on services',
    plan: [
      {
        'Node Type': 'Seq Scan',
        'Relation Name': 'services',
        Filter: NAME_FILTER,
        'Actual Rows': 3,
        'Actual Loops': 1,
        'Rows Removed by Filter': 4000,
      },
    ],
    problem: PLAN_PROBLEMS.sequentialScan,
  },
  {
    name: 'a services access that is not an index access',
    plan: [
      {
        'Node Type': 'Tid Scan',
        'Relation Name': 'services',
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
      'Index Cond': '(s.business_id = 2)',
      Filter: `(s.company_id = 1 AND ${NAME_PREDICATE})`,
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
      'Index Cond': `(s.company_id = 1 AND s.business_id = 2 AND ${NAME_PREDICATE})`,
    }),
    problem: PLAN_PROBLEMS.nameInIndexCond,
  },
  {
    name: 'a name predicate missing from the filter',
    plan: indexScan({ Filter: '(s.closed_at IS NULL)' }),
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
