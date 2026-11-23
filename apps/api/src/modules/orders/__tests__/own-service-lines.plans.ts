export interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Filter?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Actual Total Time'?: number;
  'Rows Removed by Filter'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  Plans?: PlanNode[];
}
export type Planned = { statement: string; plan: PlanNode }[];

export const CANCELLATIONS_TABLE = 'service_line_cancellations';
// الجداول الأربعة التي تقرؤها جمل القارئ: الزيارات والسطور والمنفذات، وجدول الإلغاءات للجملة السادسة.
export const TABLES = ['service_sessions', 'service_lines', 'line_performers', CANCELLATIONS_TABLE];
// جمل صفحة غير فارغة: صفوف المنفذة، السطور، الزيارات، التفاصيل (أربع ثابتة)، ثم جملة أسماء العملاء لو العمود مسموح،
// وجملة الإلغاءات لو في الصفحة سطر ملغي؛ فالحد الأقصى ستّ جمل في أثقل تركيبة، وليس خمساً.
export const BASE_PAGE_STATEMENTS = 4;
export const statementsFor = (page: { names: boolean; cancelled: boolean }) =>
  BASE_PAGE_STATEMENTS + Number(page.names) + Number(page.cancelled);
export const MAX_OWN_LINES_STATEMENTS = statementsFor({ names: true, cancelled: true });
export const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
const readsCancellations = (all: PlanNode[]) =>
  all.some((node) => node['Relation Name'] === CANCELLATIONS_TABLE);
// شروط الفهرس لكل عقد الجملة (عقدة الجدول نفسها لا تحمل شرط فهرسها في Bitmap Heap Scan بل عقدة الفهرس تحتها).
const indexConditions = (all: PlanNode[]) => all.map((node) => node['Index Cond'] ?? '').join(' ');
// هل مسح هذا الجدول مقيّد بالمستأجر في شرط فهرسه هو: عقدة Index Scan بشرطها، وفي Bitmap Heap Scan كل عقد Bitmap Index Scan تحتها
// (BitmapOr يعني كل فرع). شرط `company_id` في عقدة جدول آخر أو في Filter فقط لا يكفي: ده مسح فهرس عابر للمستأجرين بيصفّي متأخراً.
const scanIsTenantScoped = (scan: PlanNode): boolean => {
  const bitmapIndexes = nodes(scan).filter((node) => node['Node Type'] === 'Bitmap Index Scan');
  if (scan['Node Type'] === 'Bitmap Heap Scan')
    return (
      bitmapIndexes.length > 0 &&
      bitmapIndexes.every((node) => /company_id/.test(node['Index Cond'] ?? ''))
    );
  return /company_id/.test(scan['Index Cond'] ?? '');
};
const flat = (text: string) => text.replace(/\s+/g, ' ').slice(0, 60);

// البند 3 (أ): عدد الجمل ثابت، لا join، لا Seq Scan، ولا جدول يُقرأ أكثر من مرة (Actual Loops = 1) في أي جملة، على الجداول الأربعة
// (TABLES). وجملة الإلغاءات تظهر مرة واحدة بالضبط حين تكون في الصفحة سطر ملغي وإلا فلا، وشرط فهرسها يحوي `company_id`.
// هذا فحص `company_id` وحده: شرط الفهرس الحرفي على المعرفات لا يُعدّ ناجحاً هنا (انظر idListFilters).
export function planViolations(
  label: string,
  plans: Planned,
  page: { names: boolean; cancelled: boolean },
  tolerance: { cancellationsAnalysed?: boolean } = {},
) {
  const found: string[] = [];
  const expected = statementsFor(page);
  if (plans.length !== expected)
    found.push(`${label}: ${plans.length} statements planned, expected ${expected}`);
  const reading = plans.filter(({ plan }) => readsCancellations(nodes(plan)));
  if (reading.length !== Number(page.cancelled))
    found.push(
      `${label}: ${reading.length} cancellation statements planned, expected ${Number(page.cancelled)}`,
    );
  for (const { statement, plan } of plans) {
    const all = nodes(plan);
    // جدول الإلغاءات الصغير بعد ما autovacuum يحلّله يختار له المخطط Seq Scan بحق؛ فالفحصان على جملته (Index Cond وSeq Scan) يتعفيان وقتها بس.
    const exempt = tolerance.cancellationsAnalysed === true && readsCancellations(all);
    if (all.some((node) => /Join|Nested Loop/.test(node['Node Type'])))
      found.push(`${label}: join in ${flat(statement)}`);
    const scans = all.filter((node) => TABLES.includes(node['Relation Name'] ?? ''));
    // كل جدول محمي مقروء لازم يكون مسحه مقيّداً بالمستأجر في شرط فهرسه؛ الإعفاء المحلي لمسح جدول الإلغاءات المحلَّل فقط، مش لباقي الجمل.
    for (const scan of scans) {
      const tolerated = exempt && scan['Relation Name'] === CANCELLATIONS_TABLE;
      if (!tolerated && !scanIsTenantScoped(scan))
        found.push(
          `${label}: no company_id Index Cond on the ${scan['Relation Name']} scan in ${flat(statement)}`,
        );
    }
    if (!exempt && scans.some((node) => node['Node Type'] === 'Seq Scan'))
      found.push(`${label}: sequential scan in ${flat(statement)}`);
    if (scans.some((node) => (node['Actual Loops'] ?? 1) !== 1))
      found.push(`${label}: repeated scan in ${flat(statement)}`);
  }
  return found;
}

// البند 3 (ب): جمل قائمة المعرفات التي جاءت مرشّحاً لا شرط فهرس. تُسجَّل صراحة ولا تُحسب نجاحاً لفحص Index Cond الحرفي.
export const idListFilters = (plans: Planned) =>
  plans
    .filter(({ statement }) => /=\s*ANY/i.test(statement))
    .filter(({ plan }) => !/ANY/.test(indexConditions(nodes(plan))))
    .map(({ statement }) => flat(statement));

export const compactPlans = (plans: Planned) =>
  plans.map(({ statement, plan }) => ({
    statement: flat(statement),
    nodes: nodes(plan).map((node) => ({
      type: node['Node Type'],
      table: node['Relation Name'],
      index: node['Index Name'],
      cond: node['Index Cond'],
      filter: node['Filter'],
      rows: node['Actual Rows'],
      loops: node['Actual Loops'],
      removed: node['Rows Removed by Filter'],
      hit: node['Shared Hit Blocks'],
      read: node['Shared Read Blocks'],
      ms: node['Actual Total Time'],
    })),
  }));
