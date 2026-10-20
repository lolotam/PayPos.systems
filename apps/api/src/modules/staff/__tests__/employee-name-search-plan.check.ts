// فاحص خطة Postgres: دوال نقية بلا داتابيز وبلا expect، ترجع قائمة مشاكل بدل ما تفشل.
// منفصل عن ملف الاختبار عشان يبقى قابل للاختبار وحده، ولعشان تفضيل الفشل يبقى في
// طبقة واحدة: الفاحص يقول فين المخطط غلط، والاختبار يقول إن القائمة فاضية.

export interface PlanNode {
  'Node Type'?: string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Filter?: string;
  'Index Cond'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  'Rows Removed by Index Recheck'?: number;
  Plans?: PlanNode[];
}

// نصوص المشاكل ثابتة عشان اختبار الفاحص نفسه يقارن بنفسها بدل ما يكرر نصاً.
export const PLAN_PROBLEMS = {
  noEmployees: 'no employees node in the plan',
  sequentialScan: 'employees is read by a sequential scan',
  noIndexAccess: 'employees is not read through an index',
  wrongIndex: 'employees is not read through the tenant index',
  unboundTenant:
    'the employees access is not bound by company_id and business_id in the index condition',
  nameInIndexCond: 'the name predicate became an index condition',
  nameNotFilter: 'the name predicate is not a filter',
  tooManyRows: 'the node read more rows than the business holds',
} as const;

// فهرس المستأجر (company_id, business_id, id) هو ما يحدّ المسح تحت RLS (ADR-0048).
const TENANT_INDEX = /employees_company_business_id_(idx|key)/;
// العقد اللي بتطلع صفوف من الجدول، مش عقد الفهرس اللي تحتها.
const HEAP_NODE_TYPES = new Set(['Index Scan', 'Index Only Scan', 'Bitmap Heap Scan', 'Seq Scan']);
const INDEX_SCAN_TYPES = new Set(['Index Scan', 'Index Only Scan']);

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

// عقدة واحدة لكل علاقة في الشجرة، مع كل حقولها؛ العدّاد يحتاج الصفوف المقروءة لا النوع فقط.
export function planNodes(plan: unknown): PlanNode[] {
  const nodes: PlanNode[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const parsed = safeJson(value);
      if (parsed !== null) visit(parsed);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record['Node Type'] === 'string') {
      nodes.push(record as PlanNode);
      visit(record['Plans']);
      return;
    }
    visit(record['Plan']);
    visit(record['QUERY PLAN']);
  };
  visit(plan);
  return nodes;
}

// عقدة جدول الموظفين اللي بتطلع صفوف؛ عقد Bitmap Index Scan تحتها مش منها.
function employeesHeapNodes(nodes: PlanNode[]): PlanNode[] {
  return nodes.filter(
    (node) => node['Relation Name'] === 'employees' && HEAP_NODE_TYPES.has(node['Node Type'] ?? ''),
  );
}

// وصول الفهرس: العقدة نفسها لو كانت مسح فهرس، أو عقد Bitmap Index Scan تحت عقدة heap
// (مروراً بـ BitmapAnd/BitmapOr). من غير كده ما كنا هنشوف اسم الفهرس ولا شرطه.
function indexAccess(node: PlanNode): PlanNode[] {
  if (INDEX_SCAN_TYPES.has(node['Node Type'] ?? '')) return [node];
  const found: PlanNode[] = [];
  const visit = (child: PlanNode): void => {
    if (child['Node Type'] === 'Bitmap Index Scan') {
      found.push(child);
      return;
    }
    for (const grand of child.Plans ?? []) visit(grand);
  };
  for (const child of node.Plans ?? []) visit(child);
  return found;
}

// الصفوف اللي العقدة قراها: اللي رجعت، واللي الفلتر شالها، واللي الـ recheck شالها.
function rowsRead(node: PlanNode): number {
  const read =
    (node['Actual Rows'] ?? 0) +
    (node['Rows Removed by Filter'] ?? 0) +
    (node['Rows Removed by Index Recheck'] ?? 0);
  return read * (node['Actual Loops'] ?? 1);
}

/**
 * يفحص شجرة الخطة ويرجع مشاكل المسح خارج حدود النشاط (ADR-0048).
 *
 * @param nodes        عقد الخطة بعد تفكيكها
 * @param allowedRows  عدد موظفي النشاط اللي المفروض ما ينقراش أكتر منه
 * @returns قائمة المشاكل؛ فاضية يعني المخطط مربوط بمفتاح المستأجر
 */
export function tenantBoundProblems(nodes: PlanNode[], allowedRows: number): string[] {
  const heaps = employeesHeapNodes(nodes);
  if (heaps.length === 0) return [PLAN_PROBLEMS.noEmployees];
  const problems: string[] = [];
  for (const heap of heaps) {
    if (heap['Node Type'] === 'Seq Scan') problems.push(PLAN_PROBLEMS.sequentialScan);
    const accesses = indexAccess(heap);
    if (accesses.length === 0) problems.push(PLAN_PROBLEMS.noIndexAccess);
    for (const access of accesses) {
      const indexName = access['Index Name'] ?? '';
      if (!TENANT_INDEX.test(indexName)) {
        problems.push(`${PLAN_PROBLEMS.wrongIndex} (${indexName})`);
      }
      const cond = access['Index Cond'] ?? '';
      if (!cond.includes('company_id') || !cond.includes('business_id')) {
        problems.push(PLAN_PROBLEMS.unboundTenant);
      }
      if (/name_ar|name_en/.test(cond)) problems.push(PLAN_PROBLEMS.nameInIndexCond);
    }
    if (!(heap.Filter ?? '').includes('name_ar')) problems.push(PLAN_PROBLEMS.nameNotFilter);
    if (rowsRead(heap) > allowedRows) problems.push(PLAN_PROBLEMS.tooManyRows);
  }
  return problems;
}
