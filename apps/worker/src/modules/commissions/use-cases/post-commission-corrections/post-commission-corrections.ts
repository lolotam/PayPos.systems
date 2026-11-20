import { resolveSourceAttribution } from '../../domain/commission-correction-attribution.ts';
import {
  computeCommissionCorrections,
  type CommissionFrozenSource,
  type CommissionPostedCorrection,
  type CommissionRecomputedSource,
} from '../../domain/commission-correction-step.ts';
import {
  selectCommissionCorrectionTarget,
  type CommissionCorrectionCandidate,
} from '../../domain/commission-correction-target.ts';
import type { CommissionPeriodEmployee } from '../../domain/commission-line-types.ts';
import { CommissionPeriodClosedError } from '../../domain/errors.ts';
import {
  decideCommissionBlock,
  type CommissionBlockDecision,
} from '../../domain/commission-blocked-correction.ts';
import type { CommissionCorrectionScope } from '../../ports/commission-correction.port.ts';
import {
  recomputeCommissionMonth,
  type CommissionMonthRecomputedSource,
} from '../commission-month-recompute.ts';

/** هدف تصحيح واحد: شهر المصدر المغلق وكشفه، وأقرب شهر DRAFT بعده وكشفه. */
export interface CommissionCorrectionTarget {
  readonly sourcePeriod: string;
  readonly sourceStatementId: string;
  readonly targetPeriod: string;
  readonly targetStatementId: string;
}

/** يختار هدف التصحيح لكل شهر مغلق قبل أي كتابة؛ الشهر الغايب عن الأقفال أو بلا هدف DRAFT يُرفض. */
export function selectCommissionCorrectionTargets(
  locked: readonly CommissionCorrectionCandidate[],
  closedPeriods: readonly string[],
  currentPeriod: string,
): CommissionCorrectionTarget[] {
  const targets: CommissionCorrectionTarget[] = [];
  for (const sourcePeriod of closedPeriods) {
    const source = locked.find((row) => row.period === sourcePeriod);
    const target = selectCommissionCorrectionTarget(locked, sourcePeriod, currentPeriod);
    if (source === undefined || target === null) {
      throw new CommissionPeriodClosedError([sourcePeriod]);
    }
    targets.push({
      sourcePeriod,
      sourceStatementId: source.statementId,
      targetPeriod: target.period,
      targetStatementId: target.statementId,
    });
  }
  return targets;
}

interface PostCommissionCorrectionsInput {
  readonly scope: CommissionCorrectionScope;
  readonly businessId: string;
  readonly eventId: string;
  readonly targets: readonly CommissionCorrectionTarget[];
  readonly employees: readonly CommissionPeriodEmployee[];
}

/**
 * ينشر تصحيحات كل شهر مغلق لكل موظفة متأثرة داخل معاملة الحدث نفسها؛ الجيل يُرفع قبل
 * إعادة الحساب فشهر بلا فرق يأخذ جيلاً بلا صفوف، وأي فشل يُرجع الإسقاط والتصحيح معاً.
 * الشهر اللي ما يتسعّرش بيسجّل توقفاً بدل ما يفشل الحدث، والحل بيتأجّل لحدث ينجح فيه
 * الحساب وينشر (FR-046).
 */
export async function postCommissionCorrections(
  input: PostCommissionCorrectionsInput,
): Promise<void> {
  for (const target of input.targets) {
    const employees = input.employees.filter((row) => row.period === target.sourcePeriod);
    for (const { employeeId } of employees) {
      await postEmployeeCorrections(input, target, employeeId);
    }
  }
}

async function postEmployeeCorrections(
  input: PostCommissionCorrectionsInput,
  target: CommissionCorrectionTarget,
  employeeId: string,
): Promise<void> {
  const { scope, businessId } = input;
  const generation = await scope.bumpGeneration({
    businessId,
    employeeId,
    period: target.sourcePeriod,
  });
  const projection = await scope.readMonthProjection({
    businessId,
    employeeId,
    period: target.sourcePeriod,
  });
  const result = recomputeCommissionMonth(projection);
  const open = await scope.readOpenBlock({
    businessId,
    employeeId,
    sourcePeriod: target.sourcePeriod,
  });
  const decision = decideCommissionBlock(open, result);
  if (decision.kind === 'RECORD' || decision.kind === 'UPDATE_CODE' || decision.kind === 'KEEP') {
    return applyBlockedOutcome(input, target, employeeId, decision);
  }
  if (!result.ok) {
    // القرار بيغطّي كل حالات الفشل بكتابة توقوف، فالوصول لهنا كسر ثابت مش مسار متوقع.
    throw new Error('the failed month recompute has no blocked-correction decision');
  }
  await postPricedCorrections(input, target, employeeId, generation, result.sources);
  if (decision.kind === 'RESOLVE') {
    await scope.resolveBlock({ businessId, blockId: decision.blockId, generation });
  }
}

/**
 * بينشر تصحيحات الشهر اللي اتسعّر في هدف الحدث نفسه المختار وقت النشر، مش الشهر
 * المحتجز المسجّل (CM-53b)، لأن الهدف الصح بيتقاس من لقطة القفل لحظة النجاح.
 */
async function postPricedCorrections(
  input: PostCommissionCorrectionsInput,
  target: CommissionCorrectionTarget,
  employeeId: string,
  generation: number,
  sources: readonly CommissionMonthRecomputedSource[],
): Promise<void> {
  const frozen = await input.scope.readFrozenSources({
    businessId: input.businessId,
    statementId: target.sourceStatementId,
    employeeId,
  });
  const posted = await input.scope.readPostedCorrections({
    businessId: input.businessId,
    employeeId,
    sourcePeriod: target.sourcePeriod,
  });
  const recomputed = await resolveRecomputedAttributions(
    input,
    target,
    employeeId,
    frozen,
    posted,
    sources,
  );
  const drafts = computeCommissionCorrections({
    sourcePeriod: target.sourcePeriod,
    employeeId,
    generation,
    targetPeriod: target.targetPeriod,
    targetStatementId: target.targetStatementId,
    eventId: input.eventId,
    frozen,
    posted,
    recomputed,
  });
  await input.scope.insertCorrections({ businessId: input.businessId, drafts });
}

/**
 * بينفّذ قرار التوقوف بلا نشر: التسجيل بيرسم الشهر المحتجز وكشفه والحدث الأول مرة
 * واحدة من لقطة الحدث المسجّل، وتبديل الرمز بيتمسّ الرمز بس، والإبقاء بلا كتابة
 * لأني أحداث لاحقة بتعيد استعمال الصف المسجّل زي ما هو (FR-047, CM-52b, CM-53b).
 */
async function applyBlockedOutcome(
  input: PostCommissionCorrectionsInput,
  target: CommissionCorrectionTarget,
  employeeId: string,
  decision: Extract<CommissionBlockDecision, { kind: 'RECORD' | 'UPDATE_CODE' | 'KEEP' }>,
): Promise<void> {
  if (decision.kind === 'RECORD') {
    await input.scope.insertBlock({
      businessId: input.businessId,
      employeeId,
      sourcePeriod: target.sourcePeriod,
      code: decision.code,
      firstEventId: input.eventId,
      targetPeriod: target.targetPeriod,
      targetStatementId: target.targetStatementId,
    });
    return;
  }
  if (decision.kind === 'UPDATE_CODE') {
    await input.scope.updateBlockCode({
      businessId: input.businessId,
      blockId: decision.blockId,
      code: decision.code,
    });
  }
}

async function resolveRecomputedAttributions(
  input: PostCommissionCorrectionsInput,
  target: CommissionCorrectionTarget,
  employeeId: string,
  frozen: readonly CommissionFrozenSource[],
  posted: readonly CommissionPostedCorrection[],
  sources: readonly CommissionMonthRecomputedSource[],
): Promise<CommissionRecomputedSource[]> {
  const known = new Set([...frozen, ...posted].map((source) => source.sourceRef));
  if (sources.every((source) => known.has(source.sourceRef))) return [...sources];
  const attachments = await input.scope.readAttachmentSnapshot({
    businessId: input.businessId,
    statementId: target.sourceStatementId,
    employeeId,
  });
  return sources.map((source) => {
    if (known.has(source.sourceRef)) return source;
    if (source.sourceBranchId === undefined || source.sourceBusinessDate === undefined) {
      return source;
    }
    return {
      ...source,
      attribution: resolveSourceAttribution({
        sourceBranchId: source.sourceBranchId,
        sourceBusinessDate: source.sourceBusinessDate,
        attachments,
      }),
    };
  });
}
