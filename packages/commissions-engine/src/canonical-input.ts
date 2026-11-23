import { moneyToString } from '@pospay/domain';

import { groupByKey, microsToIso, ruleJson, sortedBy } from './canonical-format.ts';
import { overrideJson, planVersionJson } from './canonical-plan.ts';
import type { ServiceCommissionOverride } from './commission-types.ts';
import { assembleForLastDay, commissionPeriodLastDay } from './period-input-assembly.ts';
import type {
  IncomingCommissionCarry,
  ProjectedCommissionLine,
  ProjectedCommissionTip,
  ProjectedPackageSale,
  ReceivedCommissionCorrection,
} from './period-input-types.ts';
import type { CommissionPlanVersion, CommissionSalary } from './plan-types.ts';

/** بند الإسقاط مع `revision` رأسه: البصمة بتتحرك لما نسخة أحدث تحل محل الأقدم (D-10). */
export interface RevisedLine extends ProjectedCommissionLine {
  readonly revision: bigint;
}

/** بيع الباقة مع `revision`؛ النسخة الأحدث هي اللي بتتسعّر. */
export interface RevisedSale extends ProjectedPackageSale {
  readonly revision: bigint;
}

/** بقشيش الجلسة مع `revision` الجلسة. */
export interface RevisedTip extends ProjectedCommissionTip {
  readonly revision: bigint;
}

/** سجل الراتب مع `revision` الإدخال: الراتب بيتعرّف بالموظفة وتاريخ السريان ونسخة الإدخال (D-10). */
export interface RevisedSalary extends CommissionSalary {
  readonly revision: bigint;
}

/** تصحيح موقوف مفتوح كشفه المحتجز هو كشف الشهر ده (FR-046). */
export interface OpenBlockedCorrection {
  readonly employeeId: string;
  readonly sourcePeriod: string;
  readonly code: 'NO_PLAN' | 'NO_SALARY';
}

/** كل ما بتقراه بصمة المدخلات لنشاط وشهر واحد، من غير تصفية بالموظفة. */
export interface CanonicalInputRows {
  readonly lines: readonly RevisedLine[];
  readonly sales: readonly RevisedSale[];
  readonly tips: readonly RevisedTip[];
  readonly salaries: readonly RevisedSalary[];
  readonly versions: readonly CommissionPlanVersion[];
  readonly overrides: readonly ServiceCommissionOverride[];
  readonly corrections: readonly ReceivedCommissionCorrection[];
  readonly blocked: readonly OpenBlockedCorrection[];
  readonly carries: readonly IncomingCommissionCarry[];
}

/**
 * مفتاح ترتيب للعدد الصحيح الموجب: الحشو بالأصفار بيخلّي الترتيب النصي هو الترتيب الرقمي.
 *
 * @param value العدد الصحيح الموجب
 * @returns نص بطول ثابت
 */
function numberKey(value: bigint): string {
  return value.toString().padStart(24, '0');
}

/** كل قائمة مجمّعة بالموظفة مرة واحدة، فبناء كل موظفة بيمر على صفوفها هي بس. */
type GroupedRows = {
  readonly [K in keyof CanonicalInputRows]: Map<string, CanonicalInputRows[K][number][]>;
};

/**
 * يجمّع كل قوائم الشهر بالموظفة مرة واحدة بدل ما كل موظفة تمسح القوائم كلها.
 *
 * @param rows صفوف النشاط في الشهر
 * @returns القوائم مجمّعة بالموظفة
 */
function groupRows(rows: CanonicalInputRows): GroupedRows {
  return {
    lines: groupByKey(rows.lines, (line) => line.employeeId),
    sales: groupByKey(rows.sales, (sale) => sale.sellerEmployeeId),
    tips: groupByKey(rows.tips, (tip) => tip.employeeId),
    salaries: groupByKey(rows.salaries, (salary) => salary.employeeId),
    versions: groupByKey(rows.versions, (version) => version.employeeId),
    overrides: groupByKey(rows.overrides, (override) => override.employeeId),
    corrections: groupByKey(rows.corrections, (correction) => correction.employeeId),
    blocked: groupByKey(rows.blocked, (block) => block.employeeId),
    carries: groupByKey(rows.carries, (carry) => carry.employeeId),
  };
}

/**
 * كل موظفة ظهرت في أي قائمة، بلا فلترة بالنشاط: كتابة خطة أو تجاوز أو راتب لازم تحرّك البصمة.
 *
 * @param grouped القوائم مجمّعة بالموظفة
 * @returns معرّفات الموظفات مرتبة
 */
function employeeIdsOf(grouped: GroupedRows): string[] {
  const ids = new Set<string>();
  for (const byEmployee of Object.values(grouped)) {
    for (const employeeId of byEmployee.keys()) ids.add(employeeId);
  }
  return [...ids].sort();
}

/**
 * قوائم موظفة واحدة من التجميع.
 *
 * @param grouped القوائم مجمّعة بالموظفة
 * @param employeeId الموظفة
 * @returns صفوفها هي بس من كل قائمة
 */
function rowsOfEmployee(grouped: GroupedRows, employeeId: string): CanonicalInputRows {
  return {
    lines: grouped.lines.get(employeeId) ?? [],
    sales: grouped.sales.get(employeeId) ?? [],
    tips: grouped.tips.get(employeeId) ?? [],
    salaries: grouped.salaries.get(employeeId) ?? [],
    versions: grouped.versions.get(employeeId) ?? [],
    overrides: grouped.overrides.get(employeeId) ?? [],
    corrections: grouped.corrections.get(employeeId) ?? [],
    blocked: grouped.blocked.get(employeeId) ?? [],
    carries: grouped.carries.get(employeeId) ?? [],
  };
}

/**
 * سطر البند: الهوية والنسخة وأوقات الترتيب بدقة microsecond وحصته وقاعدته.
 *
 * @param line البند الساري
 * @returns شكل JSON آمن
 */
function lineJson(line: RevisedLine): object {
  return {
    line_id: line.lineId,
    revision: line.revision.toString(),
    occurred_at: microsToIso(line.occurredAt),
    recorded_at: microsToIso(line.recordedAt),
    business_date: line.businessDate,
    service_id: line.serviceId,
    net_share: moneyToString(line.netShare),
    share_bps: line.shareBps.toString(),
    counts: line.counts,
    rule_snapshot: ruleJson(line.ruleSnapshot),
  };
}

/**
 * سطر البيع: الهوية والنسخة ويوم العمل والمدفوع والمرتجع.
 *
 * @param sale البيع الساري
 * @returns شكل JSON آمن
 */
function saleJson(sale: RevisedSale): object {
  return {
    sale_id: sale.saleId,
    revision: sale.revision.toString(),
    business_date: sale.businessDate,
    price_paid: moneyToString(sale.pricePaid),
    refunded_amount: moneyToString(sale.refundedAmount),
  };
}

/**
 * سطر البقشيش: الجلسة ونسختها وطريقة الدفع ويومها ومبلغها.
 *
 * @param tip صف البقشيش
 * @returns شكل JSON آمن
 */
function tipJson(tip: RevisedTip): object {
  return {
    session_id: tip.sessionId,
    revision: tip.revision.toString(),
    method: tip.method,
    business_date: tip.businessDate,
    amount: moneyToString(tip.amount),
  };
}

/**
 * سطر التصحيح المستلم: شهر المصدر ومرجعه ونوعه والفرق وجيله.
 *
 * @param correction التصحيح المستلم
 * @returns شكل JSON آمن
 */
function correctionJson(correction: ReceivedCommissionCorrection): object {
  return {
    source_period: correction.sourcePeriod,
    source_ref: correction.sourceRef,
    kind: correction.kind,
    amount: moneyToString(correction.amount),
    previous_amount: moneyToString(correction.previousAmount),
    new_amount: moneyToString(correction.newAmount),
    generation: correction.generation.toString(),
  };
}

/**
 * سطر المرحّل الداخل: كشف المصدر ونوعه ومبلغه السالب (D-22).
 *
 * @param carry المرحّل الداخل
 * @returns شكل JSON آمن
 */
function carryJson(carry: IncomingCommissionCarry): object {
  return {
    source_statement_id: carry.sourceStatementId,
    kind: carry.kind,
    amount: moneyToString(carry.amount),
  };
}

/**
 * كل قوائم الموظفة بعد اختيار المجمّع المشترك، أو null لما تكون كلها فاضية.
 *
 * @param period الشهر بصيغة YYYY-MM
 * @param periodLastDay آخر يوم في الشهر، محسوب مرة واحدة
 * @param employeeId الموظفة
 * @param rows صفوف الموظفة هي بس من كل قائمة
 * @returns إدخال الموظفة أو null
 */
function employeeEntry(
  period: string,
  periodLastDay: string,
  employeeId: string,
  rows: CanonicalInputRows,
): object | null {
  const assembled = assembleForLastDay({ employeeId, period, ...rows }, periodLastDay);
  const { input } = assembled;
  const blocked = rows.blocked;
  const salary = assembled.salary;
  const entry = {
    employee_id: employeeId,
    lines: sortedBy(assembled.lines, (line) => [line.lineId]).map(lineJson),
    sales: sortedBy(assembled.sales, (sale) => [sale.saleId]).map(saleJson),
    tips: sortedBy(assembled.tips, (tip) => [tip.sessionId, tip.method]).map(tipJson),
    salary:
      salary === null
        ? null
        : {
            effective_from: salary.effectiveFrom,
            revision: salary.revision.toString(),
          },
    versions: sortedBy(input.versions, (version) => [numberKey(version.version)]).map(
      planVersionJson,
    ),
    overrides: sortedBy(input.overrides, (override) => [override.id]).map(overrideJson),
    corrections: sortedBy(assembled.corrections, (correction) => [
      correction.sourcePeriod,
      correction.sourceRef,
      numberKey(correction.generation),
    ]).map(correctionJson),
    blocked_corrections: sortedBy(blocked, (block) => [block.sourcePeriod]).map((block) => ({
      source_period: block.sourcePeriod,
      code: block.code,
    })),
    carries: sortedBy(assembled.carries, (carry) => [carry.sourceStatementId, carry.kind]).map(
      carryJson,
    ),
  };
  const lists = [entry.lines, entry.sales, entry.tips, entry.versions, entry.overrides];
  const more = [entry.corrections, entry.blocked_corrections, entry.carries];
  const empty = [...lists, ...more].every((list) => list.length === 0) && salary === null;
  return empty ? null : entry;
}

/**
 * يبني مدخل بصمة المدخلات لنشاط وشهر واحد (D-6، D-26): لكل موظفة بترتيب id، البنود الساريّة
 * والبيع والبقشيش والراتب المختار لآخر يوم والإصدارات والتجاوزات اللي ممكن تسري في الشهر
 * والتصحيحات المستلمة والتصحيحات الموقوفة المفتوحة (CS-Q38) والمرحّلات الداخلة (D-22).
 *
 * العقد الكامل (ثابت، وأي تغيير فيه يغيّر كل البصمات المخزنة):
 * - الشهر بيتتحقق منه الأول قبل أي شغل: شهر غلط بيترفض حتى لو كل القوائم فاضية.
 * - الاختيار بنفس المجمّع المشترك `assembleCommissionPeriodInput`، فمفيش مسار تاني للاختيار؛ نسخة
 *   إصلاح (`repair_period`) شهر تاني ما بتدخلش، لأن التسعير بيتجاهلها.
 * - الراتب المختار بيدخل بتاريخ سريانه و`revision` إدخاله بس، من غير المبلغ (D-10: الراتب بيتعرّف بالموظفة
 *   وتاريخ السريان ونسخة الإدخال، وأي تغيير في المبلغ بييجي بنسخة أحدث دايماً). البصمة بترجع للمراجع
 *   اللي ما بيشوفش الرواتب، وهاش من غير مفتاح لمبلغ راتب ممكن يتكسر بتجربة قيم؛ فالمبلغ مش داخل.
 * - المبالغ نصوص KWD بثلاث منازل، والأعداد الصحيحة (revision وgeneration وshare_bps وversion)
 *   نصوص عشرية، والأوقات ISO بست منازل كسرية، والتواريخ YYYY-MM-DD، والغائب `null`.
 * - كل قائمة مرتبة بهويتها: البند بـ line_id، البيع بـ sale_id، البقشيش بـ (session_id, method)،
 *   الإصدار بـ version رقمياً، التجاوز بـ id، التصحيح بـ (source_period, source_ref, generation
 *   رقمياً)، الموقوف بـ source_period، المرحّل بـ (source_statement_id, kind).
 * - الإضافة على قائمة §6: `service_id` للبند و`business_date` للبيع والبقشيش لأن المحرك بيقراهم
 *   (D-26)، والموظفة بتدخل بلا فلترة بالنشاط؛ موظفة كل قوائمها فاضية ما بتدخلش.
 * - مش داخل: إسناد الفروع (D-26)، حالة الصف (الساري بس هو اللي يدخل)، ومعرّفات التصحيحات.
 *
 * @param period الشهر بصيغة YYYY-MM
 * @param rows كل صفوف النشاط في الشهر من غير تصفية بالموظفة
 * @returns شكل JSON آمن لـ canonicalJson: نصوص وأعداد وقوائم وكائنات فقط
 */
export function buildCanonicalInput(
  period: string,
  rows: CanonicalInputRows,
): { readonly period: string; readonly employees: readonly object[] } {
  const periodLastDay = commissionPeriodLastDay(period);
  const grouped = groupRows(rows);
  const employees: object[] = [];
  for (const employeeId of employeeIdsOf(grouped)) {
    const entry = employeeEntry(
      period,
      periodLastDay,
      employeeId,
      rowsOfEmployee(grouped, employeeId),
    );
    if (entry !== null) employees.push(entry);
  }
  return { period, employees };
}
