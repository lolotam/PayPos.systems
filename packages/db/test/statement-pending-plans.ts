import type postgres from 'postgres';

const FN = 'public.statement_pending_commission_events(timestamptz)';

export interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  'Actual Rows': number;
  'Actual Loops': number;
  'Rows Removed by Filter'?: number;
  'Rows Removed by Index Recheck'?: number;
  'Exact Heap Blocks'?: number;
  'Lossy Heap Blocks'?: number;
  Plans?: PlanNode[];
}

export interface MeasuredPlan {
  readonly nodes: PlanNode[];
  readonly executionMs: number;
}

export interface PlanOptions {
  readonly tenant: string;
  /** يقيس عبر عبارة PREPAREd بمعاملَين وخطة عامة، كما تُخطَّط عبارة plpgsql المتكررة، لا نصًّا بقيم ثابتة. */
  readonly generic?: boolean;
}

class PlanCaptured extends Error {
  readonly measured: MeasuredPlan;

  constructor(measured: MeasuredPlan) {
    super('plan captured; the transaction is rolled back');
    this.measured = measured;
  }
}

/** استعلام العدّ كما هو مكتوب في الدالة المثبّتة، بعد استبدال اسمَي معامليها بالتعبيرين المعطيين. */
async function installedQuery(
  owner: postgres.Sql,
  tenant: string,
  cutoff: string,
): Promise<string> {
  const [fn] = await owner`SELECT pg_get_functiondef(${FN}::regprocedure) AS def`;
  const body = /RETURN \(([\s\S]*?)\);\s*END/.exec(fn?.['def'] as string)?.[1];
  if (body === undefined) throw new Error('the installed function has no RETURN (...) query');
  return body.replace(/\bapproval_started_at\b/g, cutoff).replace(/\btenant\b/g, tenant);
}

const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];

/**
 * يقيس خطة العدّ بدور القارئ وسياق الشركة، تنفيذًا فعليًا (ANALYZE) داخل معاملة تُلغى دائمًا (لا يبقى أثر في القاعدة).
 *
 * @param owner   اتصال مالك الـ migration (يستطيع SET ROLE)
 * @param options الشركة، وهل تكون الخطة عامة بمعاملَين
 * @returns عقد الخطة وزمن التنفيذ كما أبلغ به PostgreSQL
 */
export async function planAsReader(
  owner: postgres.Sql,
  options: PlanOptions,
): Promise<MeasuredPlan> {
  const generic = options.generic === true;
  const query = await installedQuery(
    owner,
    generic ? '$1' : `'${options.tenant}'::uuid`,
    generic ? '$2' : 'transaction_timestamp()',
  );
  // PREPAREd غير مُلغاة بـ rollback، فتبقى في جلسة الـ owner؛ لازم نلغيها بعد القياس.
  let prepared = false;
  try {
    await owner.begin(async (tx) => {
      await tx`SET LOCAL ROLE pospay_approval_reader`;
      await tx`SELECT set_config('app.company_id', ${options.tenant}, true)`;
      if (generic) {
        await tx.unsafe(`PREPARE pending_q(uuid, timestamptz) AS ${query}`);
        prepared = true;
        await tx`SET LOCAL plan_cache_mode = force_generic_plan`;
      }
      const statement = generic
        ? `EXECUTE pending_q('${options.tenant}', transaction_timestamp())`
        : query;
      const [row] = await tx.unsafe(`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`);
      const top = (row?.['QUERY PLAN'] as { Plan: PlanNode; 'Execution Time': number }[])[0] as {
        Plan: PlanNode;
        'Execution Time': number;
      };
      throw new PlanCaptured({ nodes: flatten(top.Plan), executionMs: top['Execution Time'] });
    });
  } catch (error) {
    if (error instanceof PlanCaptured) return error.measured;
    throw error;
  } finally {
    if (prepared) await owner.unsafe('DEALLOCATE pending_q');
  }
  throw new Error('unreachable: the plan transaction always rolls back');
}

/** الصفوف التي فحصتها عقد القراءة من outbox، مع ما أُسقط بالفلتر وبإعادة فحص الفهرس، مضروبة في مرات التكرار. */
export const examined = (nodes: PlanNode[]): number =>
  nodes
    .filter((node) => node['Relation Name'] === 'outbox')
    .reduce(
      (sum, node) =>
        sum +
        (node['Actual Rows'] +
          (node['Rows Removed by Filter'] ?? 0) +
          (node['Rows Removed by Index Recheck'] ?? 0)) *
          node['Actual Loops'],
      0,
    );

export const seqScansOutbox = (nodes: PlanNode[]): boolean =>
  nodes.some((node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'outbox');
