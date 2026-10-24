// المحرك النقي للعمولات — يشترك فيه الـ API والـ worker بلا نسخ لقواعد الفلوس (ADR-0054).
export { advanceAmountAccumulator } from './amount-accumulator.ts';
export { computeCalcNumerator } from './commission-calc.ts';
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
export { computePeriod } from './period-commission.ts';
export { assembleCommissionPeriodInput } from './period-input-assembly.ts';
export type {
  AssembledCommissionPeriod,
  CommissionPeriodProjection,
  CommissionProjectionStatus,
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
export { selectCommissionPlanVersion } from './plan-version.ts';
export {
  parseSalaryMultiple,
  resolveCommissionPlan,
  selectSalaryEntryOnLastDay,
  selectSalaryOnLastDay,
} from './salary-thresholds.ts';
export { resolveServiceCommissionRule } from './service-rule.ts';
export { computeTierNumerator } from './tier-evaluators.ts';
