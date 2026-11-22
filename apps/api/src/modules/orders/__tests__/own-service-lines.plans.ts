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

export const TABLES = ['service_sessions', 'service_lines', 'line_performers'];
// أعمدة كلها مسموحة: أثقل إسقاط، وجمل الصفحة الخمس كلها تُنفَّذ (بلا ملغي، فلا جملة إلغاءات).
export const STATEMENTS_PER_PAGE = 5;
export const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
const flat = (text: string) => text.replace(/\s+/g, ' ').slice(0, 60);

// البند 3 (أ): عدد الجمل ثابت، لا join، لا Seq Scan، ولا جدول يُقرأ أكثر من مرة (Actual Loops = 1) في أي جملة.
export function planViolations(label: string, plans: Planned) {
  const found: string[] = [];
  if (plans.length !== STATEMENTS_PER_PAGE)
    found.push(`${label}: ${plans.length} statements planned`);
  for (const { statement, plan } of plans) {
    const all = nodes(plan);
    if (all.some((node) => /Join|Nested Loop/.test(node['Node Type'])))
      found.push(`${label}: join in ${flat(statement)}`);
    const scans = all.filter((node) => TABLES.includes(node['Relation Name'] ?? ''));
    if (scans.some((node) => node['Node Type'] === 'Seq Scan'))
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
    .filter(
      ({ plan }) =>
        !/ANY/.test(
          nodes(plan)
            .map((node) => node['Index Cond'] ?? '')
            .join(' '),
        ),
    )
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
