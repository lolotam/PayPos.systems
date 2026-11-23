import { visibleTo } from './estimate-visibility.ts';
import type { OpenBlockedCorrection } from './canonical-input.ts';
import { computeStatementPayable, type StatementPayable } from './statement-payable.ts';
import type {
  StatementEmployeeLabel,
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
  /** موظفات برا مجموعة الكشف وعليهن تصحيح موقوف مفتوح، بطاقاتهن؛ بيظهروا لقارئ النشاط كله بس. */
  readonly unlisted: readonly StatementEmployeeLabel[];
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
 * مشاكل موظفة واحدة بترتيب ثابت: فشل تسعير شهرها ثم تصحيحاتها الموقوفة بشهر المصدر. قارئ النشاط كله
 * بيشوفهم كلهم. قارئ الفروع بيشوف بس فشل مصدر فروعه في يوم عمله بتتقاطع مع نطاقه؛ والتصحيح الموقوف مالوش
 * فرع فمش بيظهر ليه، لأن كود الفشل وشهر المصدر بيكشفوا شغل ما يقدرش يشوفه (FR-025، FR-027).
 *
 * @param employeeId الموظفة
 * @param input فشل التسعير والتصحيحات الموقوفة المفتوحة ونطاق القارئ
 * @returns المشاكل المرئية للقارئ
 */
function issuesOf(
  employeeId: string,
  input: Pick<StatementViewInput, 'failures' | 'blocked' | 'scope'>,
): StatementViewIssue[] {
  const { scope } = input;
  const branches = scope.businessWide ? null : new Set(scope.branchIds);
  const pricing = input.failures
    .filter(
      (failure) => failure.employeeId === employeeId && visibleTo(failure.attachedBranchIds, branches),
    )
    .map((failure): StatementViewIssue => ({ kind: 'PRICING', code: failure.code, sourcePeriod: null }));
  if (!scope.businessWide) return pricing;
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
 * موظفة اتجمّعت صفوفها في الباني، كما يشوفها القارئ، أو null لو مش مرئية ليه.
 *
 * @param employeeId الموظفة
 * @param all كل صفوفها من الباني
 * @param input إدخال الإسقاط
 * @returns الموظفة المرئية أو null
 */
function projectEmployee(
  employeeId: string,
  all: readonly StatementRow[],
  input: StatementViewInput,
): StatementViewEmployee | null {
  const marker = all.find((row) => row.kind === 'EMPLOYEE');
  if (marker === undefined || !rowVisible(marker, input.scope)) return null;
  const sources = all.filter(isSourceRow);
  const visible = sources
    .filter((row) => rowVisible(row, input.scope))
    .sort((a, b) => a.sourceRef.localeCompare(b.sourceRef));
  return {
    employeeId,
    employeeNumber: marker.employeeNumber,
    nameAr: marker.employeeNameAr,
    nameEn: marker.employeeNameEn,
    rows: visible,
    payable: computeStatementPayable(visible),
    partial: visible.length < sources.length,
    issues: issuesOf(employeeId, input),
  };
}

/**
 * موظفة برا مجموعة الكشف (مفيش لها مصدر ولا شغل في الشهر) وعليها تصحيح موقوف مفتوح: بتظهر لقارئ النشاط
 * كله بس، من غير صفوف، علشان المانع يتشاف ويتحل (FR-027). قارئ الفروع ما يشوفهاش لأن التصحيح مالوش فرع.
 *
 * @param label بطاقة الموظفة
 * @param input إدخال الإسقاط
 * @returns الموظفة بمشاكلها
 */
function unlistedEmployee(
  label: StatementEmployeeLabel,
  input: StatementViewInput,
): StatementViewEmployee {
  return {
    employeeId: label.employeeId,
    employeeNumber: label.employeeNumber,
    nameAr: label.nameAr,
    nameEn: label.nameEn,
    rows: [],
    payable: computeStatementPayable([]),
    partial: false,
    issues: issuesOf(label.employeeId, input),
  };
}

/**
 * يسقط صفوف الباني على ما يشوفه قارئ واحد: الموظفة ظاهرة لو صف EMPLOYEE بتاعها مرئي، وكل مجاميعها
 * محسوبة من صفوفها المرئية بنفس `computeStatementPayable` اللي هيستخدمه الاعتماد (§9)، من غير ما
 * التسعير يتعاد لكل فرع لأن الصفوف نفسها اتسعّرت على الشهر كله (CS-Q24). ومشاكل الموظفة (FR-027) بتتعرض
 * معاها بحسب نطاق القارئ (`issuesOf`). موظفة برا المجموعة بتصحيح موقوف بس بتتضاف لقارئ النشاط كله.
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
  for (const [employeeId, all] of byEmployee) {
    const employee = projectEmployee(employeeId, all, input);
    if (employee !== null) employees.push(employee);
  }
  if (input.scope.businessWide) {
    for (const label of input.unlisted) {
      if (!byEmployee.has(label.employeeId)) employees.push(unlistedEmployee(label, input));
    }
  }
  return employees.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}
