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
import type { CommissionBlockNotices } from '../../ports/commission-block-notice.port.ts';
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
  /** منفذ جرس أصحاب صلاحية خطط العمولة؛ الاختبارات اللي مش مهمها الجرس بتبني منفذ صامت صريح. */
  readonly notices: CommissionBlockNotices;
  /** الشركة المالكة للتوقف؛ قارئ حاملي الصلاحية بيحتاجها لتحديد المستلمين. */
  readonly companyId: string;
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
    employeeId,
    sourcePeriod: target.sourcePeriod,
  });
  if (!result.ok) {
    return applyBlockedOutcome(input, target, employeeId, decideCommissionBlock(open, result));
  }
  const decision = decideCommissionBlock(open, result);
  await postPricedCorrections(input, target, employeeId, generation, result.sources);
  if (decision.kind === 'RESOLVE') {
    await scope.resolveBlock({ blockId: decision.blockId, generation });
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
 * بينفّذ قرار التوقف: التسجيل بيرسم الشهر المحتجز وكشفه والحدث الأول مرة
 * واحدة من لقطة الحدث المسجّل وبيطلّع جرس أصحاب الصلاحية، وتبديل الرمز بيتمسّ
 * الرمز بس من غير جرس، والإبقاء بلا كتابة لأن أحداث لاحقة بتعيد استعمال الصف
 * المسجّل زي ما هو (FR-047, CM-52b, CM-53b, CM-54).
 */
async function applyBlockedOutcome(
  input: PostCommissionCorrectionsInput,
  target: CommissionCorrectionTarget,
  employeeId: string,
  decision: Extract<CommissionBlockDecision, { kind: 'RECORD' | 'UPDATE_CODE' | 'KEEP' }>,
): Promise<void> {
  if (decision.kind === 'RECORD') {
    const blockId = await input.scope.insertBlock({
      businessId: input.businessId,
      employeeId,
      sourcePeriod: target.sourcePeriod,
      code: decision.code,
      firstEventId: input.eventId,
      targetPeriod: target.targetPeriod,
      targetStatementId: target.targetStatementId,
    });
    await ringBlockBell(input, blockId, target.sourcePeriod);
    return;
  }
  if (decision.kind === 'UPDATE_CODE') {
    await input.scope.updateBlockCode({
      blockId: decision.blockId,
      code: decision.code,
    });
  }
}

/**
 * يطلّع جرس أصحاب صلاحية خطط العمولة مع تسجيل التوقف الأول: المستلمون أصحاب
 * الصلاحية وقت السجل، والمجموعات ما تتجاوز مية، وكل مجموعة حدث مستقل بنفس
 * معاملة التوقف، فإخفاق أي مجموعة بيلغي التوقف كمان (FR-049، CM-54).
 */
async function ringBlockBell(
  input: PostCommissionCorrectionsInput,
  blockId: string,
  sourcePeriod: string,
): Promise<void> {
  const groups = await input.notices.recipientGroups(
    input.companyId,
    input.businessId,
    input.notices.now(),
  );
  for (const [groupIndex, group] of groups.entries()) {
    await input.notices.append({
      blockId,
      groupIndex,
      businessId: input.businessId,
      sourcePeriod,
      recipients: group,
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
