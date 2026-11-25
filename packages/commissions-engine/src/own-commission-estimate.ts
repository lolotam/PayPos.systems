import { moneyToString } from '@pospay/domain';

import { assembleCommissionPeriodInput } from './period-input-assembly.ts';
import { computePeriodDetailed } from './period-commission.ts';
import { selectCommissionPlanVersion } from './plan-version.ts';
import type { CommissionPlanVersion } from './plan-types.ts';
import { computeStatementPayable } from './statement-payable.ts';
import type {
  StatementCorrectionSource,
  StatementLineHead,
  StatementMonthRows,
  StatementName,
  StatementRow,
} from './statement-types.ts';

/** بديل اسم الخدمة اللي ما لاقيش صفها: نفس القيمة اللي بيستخدمها كشف المدير (D-21). */
const MISSING_SERVICE_NAME = '—';

/** نوع التصحيح كما تراه الموظفة؛ LINE هو الذي مصدره بند زيارة وبيجيب تفاصيل الخدمة (MY-06، CS-Q30). */
export type OwnCommissionCorrectionKind = 'LINE' | 'SALE' | 'TIP_CARD' | 'TIP_CASH';

/**
 * تصحيح واحد للعرض الذاتي: نوعه وشهر مصدره ويومه واسم الخدمة وقبل وبعد والفرق.
 * ما فيه اسم عميل ولا هاتفه ولا معرّف زميلة أبداً (CS-Q30، MY-03).
 */
export interface OwnCommissionCorrectionView {
  readonly kind: OwnCommissionCorrectionKind;
  readonly sourcePeriod: string;
  readonly businessDate: string | null;
  readonly serviceNameAr: string | null;
  readonly serviceNameEn: string | null;
  readonly previousAmount: string;
  readonly newAmount: string;
  readonly amount: string;
}

/** بند من بنود الموظفة النشطة بمبلغه المسعّر في الشهر (MY-05). */
export interface OwnCommissionEstimateLineView {
  readonly lineId: string;
  readonly amount: string;
}

/** تقدير الشهر المفتوح: المجموع وبنوده وتصحيحاته وهل الحساب اتغيّر (MY-05، D-38). */
export interface OwnCommissionOpenEstimate {
  readonly status: 'ESTIMATE';
  readonly total: string;
  readonly perLine: readonly OwnCommissionEstimateLineView[];
  readonly corrections: readonly OwnCommissionCorrectionView[];
  readonly recalculated: boolean;
}

/** الشهر اللي ما اتسعرش: سبب المنع بس، والتصحيحات بتفضل ظاهرة (D-57، MY-05). */
export interface OwnCommissionUnpricedEstimate {
  readonly status: 'NO_PLAN' | 'NO_SALARY';
  readonly corrections: readonly OwnCommissionCorrectionView[];
}

/** الشهر المغلق: المبلغ المعتمد من الصفوف المجمّدة وحدها (MY-06). */
export interface OwnCommissionClosedEstimate {
  readonly status: 'APPROVED';
  readonly total: string;
  readonly corrections: readonly OwnCommissionCorrectionView[];
}

/** نتيجة تقدير عمولة الموظفة بالحالات الثلاث المحسوبة على_read. */
export type OwnCommissionEstimateProjection =
  | OwnCommissionOpenEstimate
  | OwnCommissionUnpricedEstimate
  | OwnCommissionClosedEstimate;

/**
 * مدخل تقدير الشهر المفتوح: صفوف الموظفة في الشهر، ورؤوس بنود تصحيحاتها، وأسماء خدماتها.
 */
export interface OwnCommissionEstimateInput {
  readonly employeeId: string;
  readonly period: string;
  readonly month: StatementMonthRows;
  readonly correctionLineDetails: ReadonlyMap<string, StatementLineHead>;
  readonly serviceNames: ReadonlyMap<string, StatementName>;
}

/**
 * نص مجموع بثلاث منازل بلا حد `numeric(14,3)`: مجموع صفوف كثيرة قد يتخطى حد المبلغ الواحد،
 * فالتنسيق هنا أوسع، وحد المجموع نفسه هو حد العقد (16 خانة صحيحة).
 *
 * @param mills المجموع بالفلس، موجبًا أو سالبًا
 * @returns المجموع بالدينار كنص بثلاث منازل
 */
function totalToString(mills: bigint): string {
  const sign = mills < 0n ? '-' : '';
  const abs = mills < 0n ? -mills : mills;
  return `${sign}${abs / 1000n}.${(abs % 1000n).toString().padStart(3, '0')}`;
}

/**
 * تصحيح بيع أو بقشيش: مفيش تفاصيل بند فيه، فاسم الخدمة بيفضل فاضي (spec 059 FR-033).
 *
 * @param correction التصحيح المستلم من إسقاط الشهر
 * @returns تصحيح بنوعه ومبالغه بلا اسم خدمة
 */
function openCorrectionWithoutLine(
  correction: StatementCorrectionSource,
): OwnCommissionCorrectionView {
  return {
    kind: correction.kind === 'COMMISSION' ? 'LINE' : correction.kind,
    sourcePeriod: correction.sourcePeriod,
    businessDate: correction.sourceBusinessDate,
    serviceNameAr: null,
    serviceNameEn: null,
    previousAmount: moneyToString(correction.previousAmount),
    newAmount: moneyToString(correction.newAmount),
    amount: moneyToString(correction.amount),
  };
}

/**
 * تصحيح مصدره بند زيارة: تفاصيل البند من رأس إسقاطه واسم الخدمة الحيّ؛ ورأس غايب
 * يبقى بلا تفاصيل بدل ما نخترعها (D-20).
 *
 * @param input مدخل التقدير برؤوس البنود وأسماء الخدمات
 * @param correction التصحيح الذي مصدره بند زيارة
 * @returns تصحيح بتفاصيل البند عند وجود رأسه
 */
function openLineCorrection(
  input: OwnCommissionEstimateInput,
  correction: StatementCorrectionSource,
): OwnCommissionCorrectionView {
  const lineId = correction.sourceRef.startsWith('line:') ? correction.sourceRef.slice(5) : null;
  const head = lineId === null ? undefined : input.correctionLineDetails.get(lineId);
  const service = head === undefined ? undefined : input.serviceNames.get(head.serviceId);
  return {
    kind: 'LINE',
    sourcePeriod: correction.sourcePeriod,
    businessDate: head?.businessDate ?? correction.sourceBusinessDate,
    serviceNameAr: service?.nameAr ?? null,
    serviceNameEn: service?.nameEn ?? (head === undefined ? null : MISSING_SERVICE_NAME),
    previousAmount: moneyToString(correction.previousAmount),
    newAmount: moneyToString(correction.newAmount),
    amount: moneyToString(correction.amount),
  };
}

/**
 * تصحيحات الشهر المفتوح: كل تصحيح مستلم بياخد تفاصيله، والتصحيح الذي مصدره بند
 * بيع أو بقشيش مبيجيبش اسم خدمة (FR-A02، CS-Q30).
 *
 * @param input مدخل التقدير
 * @param corrections تصحيحات الشهر المستلمة
 * @returns تصحيحات الشهر بالشكل الذاتي
 */
function openCorrections(
  input: OwnCommissionEstimateInput,
  corrections: readonly StatementCorrectionSource[],
): readonly OwnCommissionCorrectionView[] {
  return corrections.map((correction) =>
    correction.kind === 'COMMISSION'
      ? openLineCorrection(input, correction)
      : openCorrectionWithoutLine(correction),
  );
}

/**
 * هل الحساب اتغيّر: نسخة الخطة اللي تسري على الشهر كله من أوله بتعيد تسعير الشهر (D-38).
 *
 * @param input مدخل التقدير
 * @param versions نسخ الخطة المحمّلة للموظفة
 * @returns هل نسخة تسري على الشهر كله من أوله
 */
function isWholePeriodVersion(
  input: OwnCommissionEstimateInput,
  versions: readonly CommissionPlanVersion[],
): boolean {
  const version = selectCommissionPlanVersion(input.employeeId, `${input.period}-01`, versions);
  return (
    version !== null && version.wholePeriod && version.effectiveFrom.slice(0, 7) === input.period
  );
}

/**
 * يقدّر عمولة موظفة لشهرها المفتوح (DRAFT أو REVIEWED أو بلا صف كشف) على الإسقاط الحي:
 * بنودها النشطة وببيعها يُسعّران بمحرك الشهر، وبقشيشها وتصحيحاتها تعدّي بلا تسعير (D-1)،
 * وأي فشل تسعير يمنع المجموع ويبقي التصحيحات ظاهرة (MY-05، D-57).
 *
 * @param input صفوف الموظفة في الشهر ورؤوس تصحيحاتها وأسماء خدماتها
 * @returns تقدير الشهر المفتوح أو سبب منع التسعير
 */
export function computeOwnCommissionEstimate(
  input: OwnCommissionEstimateInput,
): OwnCommissionEstimateProjection {
  const assembled = assembleCommissionPeriodInput({
    ...input.month,
    employeeId: input.employeeId,
    period: input.period,
  });
  const priced = computePeriodDetailed(assembled.input);
  const corrections = openCorrections(input, assembled.corrections);
  const failure = priced.failures[0];
  if (failure !== undefined) return { status: failure.code, corrections };
  return {
    status: 'ESTIMATE',
    total: totalToString(priced.total),
    perLine: assembled.lines.map((line) => ({
      lineId: line.lineId,
      amount: moneyToString(priced.perSource.get(`line:${line.lineId}`) ?? 0n),
    })),
    corrections,
    recalculated: isWholePeriodVersion(input, assembled.input.versions),
  };
}

/**
 * نوع التصحيح في صف الكشف المجمّد: صف البند يبقى LINE، وصف البيع يبقى SALE من غير
 * تفاصيل بند، والبقشيش بنوعيه (MY-06، CS-Q30).
 *
 * @param row صف التصحيح المجمّد
 * @returns نوع التصحيح كما تراه الموظفة
 */
function closedCorrectionKind(row: StatementRow): OwnCommissionCorrectionKind {
  if (row.kind === 'CORRECTION_TIP_CARD') return 'TIP_CARD';
  if (row.kind === 'CORRECTION_TIP_CASH') return 'TIP_CASH';
  return row.lineId !== null || row.serviceId !== null || row.serviceNameEn !== null
    ? 'LINE'
    : 'SALE';
}

/**
 * هل صف الكشف المجمّد تصحيح (مش مصدر ولا صف علامة موظفة)؟
 *
 * @param row صف الكشف المجمّد
 * @returns هل الصف تصحيح
 */
function isCorrectionRow(row: StatementRow): boolean {
  return (
    row.kind === 'CORRECTION' || row.kind === 'CORRECTION_TIP_CARD' || row.kind === 'CORRECTION_TIP_CASH'
  );
}

/**
 * تصحيح من صف كشف مجمّد: تفاصيله كما رآها المدير وقت الاعتماد، واسم الخدمة على
 * تصحيح البند وحده، وما فيهش اسم عميل ولا هاتفه (CS-Q30).
 *
 * @param row صف التصحيح المجمّد
 * @returns التصحيح بتفاصيله وقت الاعتماد
 */
function closedCorrectionView(row: StatementRow): OwnCommissionCorrectionView {
  const kind = closedCorrectionKind(row);
  return {
    kind,
    sourcePeriod: row.sourcePeriod ?? '',
    businessDate: row.businessDate ?? row.sourceBusinessDate,
    serviceNameAr: kind === 'LINE' ? row.serviceNameAr : null,
    serviceNameEn: kind === 'LINE' ? row.serviceNameEn : null,
    previousAmount: row.previousAmount ?? '0.000',
    newAmount: row.newAmount ?? '0.000',
    amount: row.amount,
  };
}

/**
 * يقرأ عمولة شهر مغلق (APPROVED أو PAID) من الصفوف المجمّدة وحدها: المجموع هو
 * المستحق من تلك الصفوف، والتصحيحات بتفاصيل المدير بلا اسم عميل (MY-06، CS-Q30).
 *
 * @param rows صفوف الموظفة المجمّدة في الكشف
 * @returns المبلغ المعتمد وتصحيحات الشهر
 */
export function computeClosedOwnCommissionEstimate(
  rows: readonly StatementRow[],
): OwnCommissionClosedEstimate {
  return {
    status: 'APPROVED',
    total: totalToString(computeStatementPayable(rows).payable),
    corrections: rows.filter(isCorrectionRow).map(closedCorrectionView),
  };
}
