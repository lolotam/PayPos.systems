import type {
  CommissionEstimateAttachment,
  CommissionEstimateCorrection,
  CommissionEstimateLine,
  CommissionEstimateMonthRows,
  CommissionEstimateProjectionInput,
  CommissionEstimateTip,
} from '../estimate-projection-types.ts';
import type { CommissionPlanVersion } from '../plan-types.ts';

export const EMPLOYEE = '01920000-0000-7000-8000-0000000000e1';
export const OTHER = '01920000-0000-7000-8000-0000000000e2';
export const BRANCH_A = '01920000-0000-7000-8000-0000000000c1';
export const BRANCH_B = '01920000-0000-7000-8000-0000000000c2';
export const PERIOD = '2026-11';

/**
 * بند بنسبة ثابتة: بيتسعّر من غير خطة، ففشله مش من نوع غياب الخطة.
 *
 * @param patch الحقول اللي بتتغير عن البند الافتراضي
 * @returns بند بنسبة ثابتة
 */
export function fixedLine(patch: Partial<CommissionEstimateLine> = {}): CommissionEstimateLine {
  return {
    employeeId: EMPLOYEE,
    serviceId: 'service-a',
    lineId: 'line-a',
    occurredAt: 1n,
    recordedAt: 1n,
    businessDate: '2026-11-05',
    netShare: 100000n,
    shareBps: 10000n,
    counts: true,
    ruleSnapshot: { kind: 'PCT', value: 1000n },
    status: 'ACTIVE',
    branchId: BRANCH_A,
    ...patch,
  };
}

/**
 * بند بيتبع الخطة: من غير خطة سارية بيفشل تسعيره بـ NO_PLAN.
 *
 * @param patch الحقول اللي بتتغير عن البند الافتراضي
 * @returns بند بيتبع الخطة
 */
export function planLine(patch: Partial<CommissionEstimateLine> = {}): CommissionEstimateLine {
  return fixedLine({ lineId: 'line-plan', ruleSnapshot: { kind: 'FOLLOW_PLAN' }, ...patch });
}

/**
 * خطة بنسبة عشرة بالمئة بلا شرائح ولا بيع باقة.
 *
 * @param employeeId الموظفة صاحبة الخطة
 * @returns خطة بنسبة عشرة بالمئة
 */
export function plan(employeeId = EMPLOYEE): CommissionPlanVersion {
  return {
    employeeId,
    effectiveFrom: '2026-11-01',
    wholePeriod: false,
    repairPeriod: null,
    createdAt: 1n,
    version: 1n,
    base: { enabled: false },
    tiers: { enabled: false },
    packageSale: { enabled: false },
  };
}

/**
 * ارتباط الموظفة بفرع من بداية الشهر.
 *
 * @param patch الحقول اللي بتتغير عن الارتباط الافتراضي
 * @returns ارتباط الموظفة
 */
export function attachment(
  patch: Partial<CommissionEstimateAttachment> = {},
): CommissionEstimateAttachment {
  return {
    employeeId: EMPLOYEE,
    branchId: BRANCH_A,
    from: '2026-11-01',
    to: null,
    ...patch,
  };
}

/**
 * ارتباطات الموظفة: أول نصف الشهر في الفرع الأول وباقيته في الفرع التاني.
 *
 * @returns ارتباطين على فرعين
 */
export function transferredAttachments(): readonly CommissionEstimateAttachment[] {
  return [attachment({ to: '2026-11-15' }), attachment({ branchId: BRANCH_B, from: '2026-11-15' })];
}

/**
 * بقشيش كارت في الفرع الأول أول الشهر.
 *
 * @param patch الحقول اللي بتتغير عن البقشيش الافتراضي
 * @returns بقشيش كارت
 */
export function tip(patch: Partial<CommissionEstimateTip> = {}): CommissionEstimateTip {
  return {
    sessionId: 'tip-a',
    employeeId: EMPLOYEE,
    businessDate: '2026-11-05',
    method: 'CARD',
    amount: 2500n,
    branchId: BRANCH_A,
    ...patch,
  };
}

/**
 * تصحيح مستلم في الشهر عن مصدر من شهر مقفول، مربوط بالفرع الأول.
 *
 * @param patch الحقول اللي بتتغير عن التصحيح الافتراضي
 * @returns تصحيح مستلم
 */
export function correction(
  patch: Partial<CommissionEstimateCorrection> = {},
): CommissionEstimateCorrection {
  return {
    employeeId: EMPLOYEE,
    sourcePeriod: '2026-10',
    targetPeriod: PERIOD,
    sourceRef: 'line:old-a',
    kind: 'COMMISSION',
    amount: 5000n,
    previousAmount: 0n,
    newAmount: 5000n,
    generation: 1n,
    sourceBranchId: BRANCH_A,
    sourceBusinessDate: '2026-10-05',
    attachedBranchIds: [BRANCH_A],
    ...patch,
  };
}

/**
 * صفوف شهر النشاط: كل القوايم فاضية غير اللي الاختبار بيملاها.
 *
 * @param patch القوايم اللي بتتغير عن الشهر الفاضي
 * @returns صفوف شهر النشاط
 */
export function month(
  patch: Partial<CommissionEstimateMonthRows> = {},
): CommissionEstimateMonthRows {
  return {
    lines: [],
    sales: [],
    tips: [],
    salaries: [],
    versions: [],
    overrides: [],
    corrections: [],
    ...patch,
  };
}

/**
 * مدخل تقدير شهر: قارئ على مستوى الفرع الأول، بلا موظفات ولا ارتباطات.
 *
 * @param patch الحقول اللي بتتغير عن المدخل الافتراضي
 * @returns مدخل تقدير شهر
 */
export function projection(
  patch: Partial<CommissionEstimateProjectionInput> = {},
): CommissionEstimateProjectionInput {
  return {
    scope: { businessWide: false, branchIds: [BRANCH_A] },
    period: PERIOD,
    employeeIds: [EMPLOYEE],
    month: month(),
    attachments: [],
    ...patch,
  };
}
