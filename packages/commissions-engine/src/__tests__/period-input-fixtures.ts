import type { ServiceCommissionOverride } from '../commission-types.ts';
import type {
  CommissionPeriodProjection,
  ProjectedCommissionLine,
  ProjectedCommissionTip,
  ProjectedPackageSale,
  ReceivedCommissionCorrection,
} from '../period-input-types.ts';
import type { CommissionSalary } from '../plan-types.ts';
import { line, pct, sale, version } from './engine-ii-fixtures.ts';

/** يصنع بنداً نشطاً اصطناعياً مع إبقاء حقول المحرك الأصلية للاختبار. */
export function projectedLine(
  patch: Partial<ProjectedCommissionLine> = {},
): ProjectedCommissionLine {
  return { ...line(), status: 'ACTIVE', ...patch };
}

/** يصنع بيع باقة نشطاً اصطناعياً لاختبار التجميع دون تسعير جديد. */
export function projectedSale(patch: Partial<ProjectedPackageSale> = {}): ProjectedPackageSale {
  return { ...sale(), status: 'ACTIVE', ...patch };
}

/** يصنع سجل راتب اصطناعياً لاختبارات الاختيار في آخر يوم. */
export function salaryEntry(
  employeeId: string,
  effectiveFrom: string,
  amount: bigint,
): CommissionSalary {
  return { employeeId, effectiveFrom, amount };
}

/** يصنع تجاوز خدمة اصطناعياً لاختبار نطاق الموظفة والتاريخ. */
export function serviceOverride(
  patch: Partial<ServiceCommissionOverride> = {},
): ServiceCommissionOverride {
  return {
    id: 'override-a',
    employeeId: 'employee-a',
    serviceId: 'service-a',
    effectiveFrom: '2026-10-01',
    createdAt: 1n,
    rule: pct(500n),
    ...patch,
  };
}

/** يصنع إكرامية اصطناعية تبقى خارج تسعير العمولة. */
export function tip(patch: Partial<ProjectedCommissionTip> = {}): ProjectedCommissionTip {
  return {
    sessionId: 'session-a',
    employeeId: 'employee-a',
    businessDate: '2026-10-10',
    method: 'CARD',
    amount: 5000n,
    ...patch,
  };
}

/** يصنع تصحيحاً مستلماً اصطناعياً لاختبار شهر الهدف والمرور دون تسعير. */
export function correction(
  patch: Partial<ReceivedCommissionCorrection> = {},
): ReceivedCommissionCorrection {
  return {
    employeeId: 'employee-a',
    sourcePeriod: '2026-09',
    targetPeriod: '2026-10',
    sourceRef: 'line:a',
    kind: 'COMMISSION',
    amount: 500n,
    previousAmount: 1000n,
    newAmount: 1500n,
    generation: 1n,
    ...patch,
  };
}

/** يجمع مدخلات أكتوبر الاصطناعية لتتكرر سيناريوهات التجميع بلا قاعدة بيانات. */
export function projection(
  patch: Partial<CommissionPeriodProjection> = {},
): CommissionPeriodProjection {
  return {
    employeeId: 'employee-a',
    period: '2026-10',
    lines: [],
    sales: [],
    salaries: [],
    versions: [version()],
    overrides: [],
    tips: [],
    corrections: [],
    ...patch,
  };
}
