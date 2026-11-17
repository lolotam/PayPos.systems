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
import { affectedCommissionLineEmployees } from '../../domain/commission-lines.ts';
import type {
  CommissionLineSnapshot,
  CommissionPeriodEmployee,
} from '../../domain/commission-line-types.ts';
import { CommissionPeriodClosedError } from '../../domain/errors.ts';
import type { CommissionCorrectionScope } from '../../ports/commission-correction.port.ts';
import type { CommissionLineProjectionScope } from '../../ports/commission-line-projection.port.ts';
import {
  recomputeCommissionMonth,
  type CommissionMonthRecomputedSource,
} from '../commission-month-recompute.ts';

export interface CommissionLineCorrectionTarget {
  readonly sourcePeriod: string;
  readonly sourceStatementId: string;
  readonly targetPeriod: string;
  readonly targetStatementId: string;
}

export function selectCommissionLineCorrectionTargets(
  locked: readonly CommissionCorrectionCandidate[],
  closedPeriods: readonly string[],
  currentPeriod: string,
): CommissionLineCorrectionTarget[] {
  const targets: CommissionLineCorrectionTarget[] = [];
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

export async function readCommissionLineCorrectionEmployees(
  scope: CommissionLineProjectionScope,
  lines: readonly CommissionLineSnapshot[],
  closedPeriods: readonly string[],
): Promise<readonly CommissionPeriodEmployee[]> {
  if (closedPeriods.length === 0) return [];
  const stored = await scope.readLinePerformers(lines.map((line) => line.lineId));
  return affectedCommissionLineEmployees(lines, stored, closedPeriods);
}

interface PostLineCorrectionsInput {
  readonly scope: CommissionCorrectionScope;
  readonly businessId: string;
  readonly eventId: string;
  readonly targets: readonly CommissionLineCorrectionTarget[];
  readonly employees: readonly CommissionPeriodEmployee[];
}

export async function postCommissionLineCorrections(
  input: PostLineCorrectionsInput,
): Promise<void> {
  for (const target of input.targets) {
    const employees = input.employees.filter((row) => row.period === target.sourcePeriod);
    for (const { employeeId } of employees) {
      await postEmployeeCorrections(input, target, employeeId);
    }
  }
}

async function postEmployeeCorrections(
  input: PostLineCorrectionsInput,
  target: CommissionLineCorrectionTarget,
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
  if (!result.ok) throw new CommissionPeriodClosedError([target.sourcePeriod]);
  const frozen = await scope.readFrozenSources({
    businessId,
    statementId: target.sourceStatementId,
    employeeId,
  });
  const posted = await scope.readPostedCorrections({
    businessId,
    employeeId,
    sourcePeriod: target.sourcePeriod,
  });
  const recomputed = await resolveRecomputedAttributions(
    input,
    target,
    employeeId,
    frozen,
    posted,
    result.sources,
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
  await scope.insertCorrections({ businessId, drafts });
}

async function resolveRecomputedAttributions(
  input: PostLineCorrectionsInput,
  target: CommissionLineCorrectionTarget,
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
