import { visibleTo } from './estimate-visibility.ts';
import type { OpenBlockedCorrection } from './canonical-input.ts';
import { computeStatementPayable, type StatementPayable } from './statement-payable.ts';
import type {
  StatementPricingFailure,
  StatementRow,
  StatementRowKind,
} from './statement-types.ts';

/** صف مصدر في العرض: كل أنواع الصفوف ما عدا صف EMPLOYEE اللي بيحدد ظهور الموظفة بس. */
export type StatementSourceRow = StatementRow & {
  readonly kind: Exclude<StatementRowKind, 'EMPLOYEE'>;
};

/**
 * هل الصف مصدر (مش علامة الموظفة)؟
 *
 * @param row صف الكشف
 * @returns هل هو صف مصدر
 */
function isSourceRow(row: StatementRow): row is StatementSourceRow {
  return row.kind !== 'EMPLOYEE';
}

/** نطاق القارئ: النشاط كله، أو فروع محددة بتتقاطع مع `attached_branch_ids` الصف (CS-Q20). */
export interface StatementViewScope {
  readonly businessWide: boolean;
  readonly branchIds: readonly string[];
}

/** مشكلة بتمنع المراجعة والاعتماد (FR-027): فشل تسعير، أو تصحيح موقوف مفتوح لشهر مصدر. */
export interface StatementViewIssue {
  readonly kind: 'PRICING' | 'BLOCKED_CORRECTION';
  readonly code: 'NO_PLAN' | 'NO_SALARY';
  /** شهر مصدر التصحيح الموقوف، و`null` لفشل تسعير الشهر نفسه. */
  readonly sourcePeriod: string | null;
}

/** موظفة في الكشف كما يشوفها القارئ: صفوفها المرئية، ومجاميعها منها هي، وهل شهرها ناقص عليه. */
export interface StatementViewEmployee {
  readonly employeeId: string;
  readonly employeeNumber: number;
  readonly nameAr: string | null;
  readonly nameEn: string;
  /** صفوف الموظفة المرئية من غير صف EMPLOYEE، مرتبة بمرجع المصدر. */
  readonly rows: readonly StatementSourceRow[];
  readonly payable: StatementPayable;
  /** في صف من شهرها برا نطاق القارئ، فأرقامها مجموع جزء من الشهر (CS-Q23). */
  readonly partial: boolean;
  readonly issues: readonly StatementViewIssue[];
}

/** ما بيحتاجه إسقاط العرض: صفوف الباني بكل موظفينه، والمشاكل، ونطاق القارئ. */
export interface StatementViewInput {
  readonly rows: readonly StatementRow[];
  readonly failures: readonly StatementPricingFailure[];
  readonly blocked: readonly OpenBlockedCorrection[];
  readonly scope: StatementViewScope;
}

/**
 * الصف مرئي للقارئ على مستوى النشاط دايماً، ولغيره لما فروعه المرتبطة بتتقاطع مع نطاقه؛ صف من غير
 * فروع (المرحّل مثلاً) مش مرئي إلا لقارئ النشاط كله (FR-028).
 *
 * @param row صف الكشف
 * @param scope نطاق القارئ
 * @returns هل الصف مرئي
 */
function rowVisible(row: StatementRow, scope: StatementViewScope): boolean {
  return visibleTo(row.attachedBranchIds, scope.businessWide ? null : new Set(scope.branchIds));
}

/**
 * مشاكل موظفة واحدة بترتيب ثابت: فشل تسعير شهرها ثم تصحيحاتها الموقوفة بشهر المصدر.
 *
 * @param employeeId الموظفة
 * @param input فشل التسعير والتصحيحات الموقوفة المفتوحة
 * @returns المشاكل
 */
function issuesOf(
  employeeId: string,
  input: Pick<StatementViewInput, 'failures' | 'blocked'>,
): StatementViewIssue[] {
  const pricing = input.failures
    .filter((failure) => failure.employeeId === employeeId)
    .map((failure): StatementViewIssue => ({ kind: 'PRICING', code: failure.code, sourcePeriod: null }));
  const blocked = input.blocked
    .filter((block) => block.employeeId === employeeId)
    .sort((a, b) => a.sourcePeriod.localeCompare(b.sourcePeriod))
    .map(
      (block): StatementViewIssue => ({
        kind: 'BLOCKED_CORRECTION',
        code: block.code,
        sourcePeriod: block.sourcePeriod,
      }),
    );
  return [...pricing, ...blocked];
}

/**
 * يسقط صفوف الباني على ما يشوفه قارئ واحد: الموظفة ظاهرة لو صف EMPLOYEE بتاعها مرئي، وكل مجاميعها
 * محسوبة من صفوفها المرئية بنفس `computeStatementPayable` اللي هيستخدمه الاعتماد (§9)، من غير ما
 * التسعير يتعاد لكل فرع لأن الصفوف نفسها اتسعّرت على الشهر كله (CS-Q24). ومشاكل الموظفة (FR-027) بتتعرض
 * معاها هي بس.
 *
 * @param input صفوف الباني والمشاكل ونطاق القارئ
 * @returns الموظفات المرئيات بترتيب المعرّف
 */
export function projectStatementView(input: StatementViewInput): StatementViewEmployee[] {
  const byEmployee = new Map<string, StatementRow[]>();
  for (const row of input.rows) {
    const list = byEmployee.get(row.employeeId) ?? [];
    list.push(row);
    byEmployee.set(row.employeeId, list);
  }
  const employees: StatementViewEmployee[] = [];
  for (const employeeId of [...byEmployee.keys()].sort()) {
    const all = byEmployee.get(employeeId) ?? [];
    const marker = all.find((row) => row.kind === 'EMPLOYEE');
    if (marker === undefined || !rowVisible(marker, input.scope)) continue;
    const sources = all.filter(isSourceRow);
    const visible = sources
      .filter((row) => rowVisible(row, input.scope))
      .sort((a, b) => a.sourceRef.localeCompare(b.sourceRef));
    employees.push({
      employeeId,
      employeeNumber: marker.employeeNumber,
      nameAr: marker.employeeNameAr,
      nameEn: marker.employeeNameEn,
      rows: visible,
      payable: computeStatementPayable(visible),
      partial: visible.length < sources.length,
      issues: issuesOf(employeeId, input),
    });
  }
  return employees;
}
