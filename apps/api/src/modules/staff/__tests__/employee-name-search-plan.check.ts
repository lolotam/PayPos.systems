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
  unboundTenant:
    'the employees access is not bound by company_id and business_id in the index condition',
  nameInIndexCond: 'the name predicate became an index condition',
  nameNotFilter: 'the name predicate is not a filter',
  tooManyRows: 'the node read more rows than the business holds',
} as const;

// عقد الفهرس اللي تحت عقدة الجدول مش عقد جدول؛ الـ BitmapAnd/BitmapOr مجرد تجميع.
const BITMAP_INDEX_NODE = 'Bitmap Index Scan';
const INDEX_SCAN_TYPES = new Set(['Index Scan', 'Index Only Scan']);
const INDEX_NODE_TYPES = new Set(['Index Scan', 'Index Only Scan', BITMAP_INDEX_NODE]);

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

// تفكيك المخطط لعقد: الفاحص محتاج كل عقدة على حدة لأنها هي اللي بتحمل شرط الفهرس
// والصفوف المقروءة، وعقد الجدول الواحد ممكن يتكرر في الشجرة.
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

// كل عقدة بتطلع صفوف من جدول الموظفين؛ عقد فهرس جدول الموظفين تحت heap مش منها.
// أي نوع تاني نتعامل معاه كـ heap عشان نوع غير معروف يسقط الاختبار بدل ما يعدّي صامت.
function employeesHeapNodes(nodes: PlanNode[]): PlanNode[] {
  return nodes.filter(
    (node) => node['Relation Name'] === 'employees' && node['Node Type'] !== BITMAP_INDEX_NODE,
  );
}

// الوصول للفهرس: العقدة نفسها لو كانت مسح فهرس، أو جذر شجرة الـ bitmap تحت عقدة الجدول.
// من غير كده ما كنا هنشوف شرط الفهرس ولا نعرف هو مربوط بالمستأجر ولا لأ.
function indexAccess(node: PlanNode): PlanNode | null {
  if (INDEX_SCAN_TYPES.has(node['Node Type'] ?? '')) return node;
  return (node.Plans ?? [])[0] ?? null;
}

// العقدة مربوطة بمفتاح المستأجر لو شرط الفهرس فيها فيه الشركة والنشاط معاً؛
// الـ BitmapAnd بيضيّق فأي فرع مربوط يكفي، والـ BitmapOr بيوسّع فكل فرع لازم يكون مربوط.
function isTenantBound(node: PlanNode): boolean {
  const type = node['Node Type'];
  if (type !== undefined && INDEX_NODE_TYPES.has(type)) {
    const cond = node['Index Cond'] ?? '';
    return cond.includes('company_id') && cond.includes('business_id');
  }
  const children = node.Plans ?? [];
  if (type === 'BitmapAnd') return children.some(isTenantBound);
  if (type === 'BitmapOr') return children.length > 0 && children.every(isTenantBound);
  return false;
}

// كل عقدة فهرس في شجرة الوصول؛ شرط الاسم ما يصحّش يتحوّل لشرط فهرس في أي فرع منها.
function indexNodes(access: PlanNode): PlanNode[] {
  if (INDEX_NODE_TYPES.has(access['Node Type'] ?? '')) return [access];
  return (access.Plans ?? []).flatMap(indexNodes);
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
    if (heap['Node Type'] === 'Seq Scan') {
      problems.push(PLAN_PROBLEMS.sequentialScan);
    } else {
      const access = indexAccess(heap);
      if (access === null) {
        problems.push(PLAN_PROBLEMS.noIndexAccess);
      } else {
        if (!isTenantBound(access)) problems.push(PLAN_PROBLEMS.unboundTenant);
        for (const index of indexNodes(access)) {
          if (/name_ar|name_en/.test(index['Index Cond'] ?? '')) {
            problems.push(PLAN_PROBLEMS.nameInIndexCond);
          }
        }
      }
    }
    if (!(heap.Filter ?? '').includes('name_ar')) problems.push(PLAN_PROBLEMS.nameNotFilter);
    if (rowsRead(heap) > allowedRows) problems.push(PLAN_PROBLEMS.tooManyRows);
  }
  return problems;
}
