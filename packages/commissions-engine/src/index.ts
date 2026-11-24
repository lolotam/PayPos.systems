// المحرك النقي للعمولات — يشترك فيه الـ API والـ worker بلا نسخ لقواعد الفلوس (ADR-0054).
export { advanceAmountAccumulator } from './amount-accumulator.ts';
export { roundCashPayable } from './cash-payable.ts';
export { buildCanonicalInput } from './canonical-input.ts';
export type {
  CanonicalInputRows,
  OpenBlockedCorrection,
  RevisedLine,
  RevisedSalary,
  RevisedSale,
  RevisedTip,
} from './canonical-input.ts';
export { parseCarryKind } from './carry-kind.ts';
export { buildStatement, StatementCardConflictError } from './statement-builder.ts';
export { StatementDuplicateKeyError } from './statement-uniqueness.ts';
export {
  statementAttachmentFromStored,
  statementFingerprintInput,
  statementRowFromStored,
} from './statement-fingerprint.ts';
export type { StoredStatementAttachment, StoredStatementLine } from './statement-fingerprint.ts';
export type {
  StatementAttachmentRow,
  StatementBuild,
  StatementBuildInput,
  StatementCorrectionSource,
  StatementEmployeeLabel,
  StatementLineHead,
  StatementLineSource,
  StatementMonthRows,
  StatementName,
  StatementNames,
  StatementPricingFailure,
  StatementRow,
  StatementRowKind,
  StatementSaleSource,
  StatementTipSource,
} from './statement-types.ts';
export { computeCalcNumerator } from './commission-calc.ts';
export { projectCommissionEstimate } from './estimate-projection.ts';
export type {
  CommissionEstimateAttachment,
  CommissionEstimateCorrection,
  CommissionEstimateCorrectionProjection,
  CommissionEstimateEmployeeProjection,
  CommissionEstimateLine,
  CommissionEstimateMonthRows,
  CommissionEstimateProjection,
  CommissionEstimateProjectionInput,
  CommissionEstimateSale,
  CommissionEstimateSaleProjection,
  CommissionEstimateScope,
  CommissionEstimateSourceProjection,
  CommissionEstimateStatus,
  CommissionEstimateTip,
} from './estimate-projection-types.ts';
export type {
  AmountTierStep,
  CommissionCalc,
  CommissionLineOrder,
  CommissionLineResult,
  CommissionPricingLine,
  CommissionRuleLine,
  LinePerformerShare,
  MarginalAmountPlan,
  ServiceCommissionOverride,
  ServiceCommissionRule,
} from './commission-types.ts';
export {
  addComparison,
  addUnmarkedPage,
  appendCapped,
  emptyCappedList,
  emptyCoverageTotals,
  emptyUnmarkedTotals,
} from './coverage-accumulation.ts';
export type {
  CappedList,
  CoverageTotals,
  UnmarkedTotals,
} from './coverage-accumulation.ts';
export {
  compareCoverage,
  coverageKey,
  findUnmarkedEventIds,
} from './coverage-comparison.ts';
export type { CoverageComparison, CoverageRow } from './coverage-comparison.ts';
export type {
  CommissionConfigurationError,
  CommissionValidationError,
  CommissionValidationResult,
} from './errors.ts';
export { computeFollowPlanLine, computeLineCommission } from './line-commission.ts';
export { orderCommissionLines } from './line-order.ts';
export { allocateLineShares } from './line-shares.ts';
export { computeMarginalTierNumerator, findActiveTierStep } from './marginal-tiers.ts';
export { computePackageSaleCommission } from './package-sale-commission.ts';
export { projectPackageSaleStatus } from './package-sale-status.ts';
export { computePeriod, computePeriodDetailed } from './period-commission.ts';
export { projectStatementView } from './statement-view.ts';
export type {
  StatementSourceRow,
  StatementViewEmployee,
  StatementViewInput,
  StatementViewIssue,
  StatementViewScope,
} from './statement-view.ts';
export { computeStatementPayable } from './statement-payable.ts';
export type { PayableRow, StatementPayable } from './statement-payable.ts';
export type {
  CommissionPeriodDetailedResult,
  CommissionPricingFailure,
} from './period-commission.ts';
export { assembleCommissionPeriodInput } from './period-input-assembly.ts';
export type {
  AssembledCommissionPeriod,
  CommissionPeriodProjection,
  CommissionProjectionStatus,
  IncomingCommissionCarry,
  ProjectedCommissionLine,
  ProjectedCommissionTip,
  ProjectedPackageSale,
  ReceivedCommissionCorrection,
} from './period-input-types.ts';
export type {
  CommissionComponent,
  CommissionPackageSale,
  CommissionPeriodInput,
  CommissionPeriodResult,
  CommissionPlan,
  CommissionPlanVersion,
  CommissionSalary,
  CommissionTierStep,
  CommissionThreshold,
  CommissionTiers,
  PeriodCommissionLine,
  ResolvedCommissionPlan,
} from './plan-types.ts';
export { validateCommissionPlan } from './plan-validation.ts';
export {
  commissionOverrideOf,
  commissionPlanVersionOf,
  commissionRuleOf,
  CommissionPlanDecodeError,
  type StoredOverrideRow,
  type StoredPlanVersionRow,
} from './plan-version-decode.ts';
export { selectCommissionPlanVersion } from './plan-version.ts';
export { validateWireCommissionPlan } from './plan-wire.ts';
export type { CommissionPlanWire } from './plan-wire.ts';
export {
  parseSalaryMultiple,
  resolveCommissionPlan,
  selectSalaryEntryOnLastDay,
  selectSalaryOnLastDay,
} from './salary-thresholds.ts';
export { resolveServiceCommissionRule } from './service-rule.ts';
export { computeTierNumerator } from './tier-evaluators.ts';
