// شاشة منشئ الخطط في الأدمن تشغّل نفس مُتحقّق الخطة الذي تشغّله الـ API (D-17, CM-06).
export { validateCommissionPlan } from './plan-validation.ts';
export type { CommissionValidationError, CommissionValidationResult } from './errors.ts';
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
