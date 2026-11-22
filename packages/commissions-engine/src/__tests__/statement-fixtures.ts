import type {
  CanonicalInputRows,
  RevisedLine,
  RevisedSale,
  RevisedTip,
} from '../canonical-input.ts';
import type { ReceivedCommissionCorrection } from '../period-input-types.ts';

/** بند الشهر مع حقول المستدعي اللي بصمة المدخلات ما بتملكهاش: الفرع والجلسة والعميل (D-26). */
export interface StatementLineSource extends RevisedLine {
  readonly branchId: string;
  readonly sessionId: string;
  readonly customerId: string | null;
}

/** بيع الباقة مع فرعه. */
export interface StatementSaleSource extends RevisedSale {
  readonly branchId: string;
}

/** بقشيش الشهر مع فرعه. */
export interface StatementTipSource extends RevisedTip {
  readonly branchId: string;
}

/** تصحيح مستلم مع معرّفه وإسناد فروعه المجمّد. */
export interface StatementCorrectionSource extends ReceivedCommissionCorrection {
  readonly id: string;
  readonly sourceBranchId: string;
  readonly sourceBusinessDate: string;
  readonly attachedBranchIds: readonly string[];
}

/** صفوف الشهر كلها لنشاط واحد، بحقول المستدعي. */
export interface StatementMonthRows extends CanonicalInputRows {
  readonly lines: readonly StatementLineSource[];
  readonly sales: readonly StatementSaleSource[];
  readonly tips: readonly StatementTipSource[];
  readonly corrections: readonly StatementCorrectionSource[];
}

export const PERIOD = '2026-10';
export const SARA = 'employee-sara';
export const NOOR = 'employee-noor';
export const SALMIYA = 'branch-salmiya';
export const HAWALLI = 'branch-hawalli';

/**
 * عنصر بالموضع، وبيرمي لو مش موجود؛ بديل علامة `!` الممنوعة، وفشله خلل في الفيكستشر مش في المنتج.
 *
 * @param list القائمة
 * @param index الموضع
 * @returns العنصر
 */
export function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new RangeError(`fixture index ${index} is missing`);
  return item;
}

/**
 * بند ساري بنسبة لقطة 5% افتراضياً: صافي النصيب بالفلس والخدمة والفرع ويوم العمل.
 *
 * @param patch الحقول اللي بتتغيّر عن الافتراضي
 * @returns بند الشهر
 */
function line(patch: Partial<StatementLineSource>): StatementLineSource {
  return {
    employeeId: SARA,
    lineId: 'line-1',
    serviceId: 'service-1',
    branchId: SALMIYA,
    sessionId: 'session-1',
    customerId: 'customer-1',
    revision: 1n,
    occurredAt: 1_790_000_000_000_001n,
    recordedAt: 1_790_000_000_000_002n,
    businessDate: '2026-10-05',
    netShare: 100_000n,
    shareBps: 10_000n,
    counts: true,
    ruleSnapshot: { kind: 'PCT', value: 500n },
    status: 'ACTIVE',
    ...patch,
  };
}

/**
 * بنود أكتوبر: بندان لسارة في فرعين وبند لنور؛ تجاوز الخدمة ١ بيغلب لقطة بند سارة الأول.
 *
 * @returns بنود الشهر
 */
function octoberLines(): StatementLineSource[] {
  return [
    line({ revision: 2n }),
    line({
      lineId: 'line-2',
      serviceId: 'service-2',
      branchId: HAWALLI,
      sessionId: 'session-2',
      customerId: null,
      occurredAt: 1_790_900_000_000_000n,
      recordedAt: 1_790_900_000_000_001n,
      businessDate: '2026-10-20',
      netShare: 50_000n,
    }),
    line({
      employeeId: NOOR,
      lineId: 'line-3',
      sessionId: 'session-3',
      occurredAt: 1_790_300_000_000_000n,
      recordedAt: 1_790_300_000_000_001n,
      businessDate: '2026-10-08',
      netShare: 20_000n,
      ruleSnapshot: { kind: 'PCT', value: 1_000n },
    }),
  ];
}

/**
 * بيع باقة لسارة بمرتجع، وبقشيش كارت وكاش لجلسة بند سارة الأول.
 *
 * @returns البيع والبقشيش
 */
function octoberSalesAndTips(): Pick<StatementMonthRows, 'sales' | 'tips'> {
  const tip = {
    sessionId: 'session-1',
    employeeId: SARA,
    branchId: SALMIYA,
    revision: 1n,
    businessDate: '2026-10-05',
  };
  return {
    sales: [
      {
        saleId: 'sale-1',
        sellerEmployeeId: SARA,
        branchId: SALMIYA,
        revision: 1n,
        businessDate: '2026-10-10',
        pricePaid: 50_000n,
        refundedAmount: 10_000n,
        status: 'ACTIVE',
      },
    ],
    tips: [
      { ...tip, method: 'CARD', amount: 6_000n },
      { ...tip, method: 'CASH', amount: 2_000n },
    ],
  };
}

/**
 * الراتب والخطة (بيع الباقة 10%) وتجاوز الخدمة ١ بـ 15%.
 *
 * @returns الراتب والإصدارات والتجاوزات
 */
function octoberPlanning(): Pick<StatementMonthRows, 'salaries' | 'versions' | 'overrides'> {
  return {
    salaries: [{ employeeId: SARA, effectiveFrom: '2026-10-01', amount: 400_000n }],
    versions: [
      {
        employeeId: SARA,
        effectiveFrom: '2026-10-01',
        wholePeriod: false,
        repairPeriod: null,
        createdAt: 1_789_000_000_000_001n,
        version: 1n,
        base: { enabled: false },
        tiers: { enabled: false },
        packageSale: { enabled: true, calc: { kind: 'PCT', value: 1_000n } },
      },
    ],
    overrides: [
      {
        id: 'override-1',
        employeeId: SARA,
        serviceId: 'service-1',
        effectiveFrom: '2026-10-01',
        createdAt: 1_789_000_000_000_002n,
        rule: { kind: 'PCT', value: 1_500n },
      },
    ],
  };
}

/**
 * تصحيح مستلم من سبتمبر، وتصحيح موقوف مفتوح لنور، والترحيلين (العمولة وبقشيش الكارت) من كشف سبتمبر.
 *
 * @returns التصحيحات والموقوف والمرحّلات
 */
function octoberAdjustments(): Pick<StatementMonthRows, 'corrections' | 'blocked' | 'carries'> {
  const carry = {
    employeeId: SARA,
    sourceStatementId: 'statement-sep',
    sourcePeriod: '2026-09',
    targetPeriod: PERIOD,
  };
  return {
    corrections: [
      {
        id: 'correction-1',
        employeeId: SARA,
        sourcePeriod: '2026-09',
        targetPeriod: PERIOD,
        sourceRef: 'line:old-1',
        kind: 'COMMISSION',
        amount: 3_000n,
        previousAmount: 0n,
        newAmount: 3_000n,
        generation: 1n,
        sourceBranchId: SALMIYA,
        sourceBusinessDate: '2026-09-28',
        attachedBranchIds: [SALMIYA],
      },
    ],
    blocked: [{ employeeId: NOOR, sourcePeriod: '2026-08', code: 'NO_PLAN' }],
    carries: [
      { ...carry, kind: 'COMMISSION', amount: -5_000n },
      { ...carry, kind: 'TIP_CARD', amount: -2_000n },
    ],
  };
}

/**
 * أكتوبر غير تافه (CM-34e): سارة بفرعين، بندان وبيع بمرتجع وبقشيش كارت وكاش وراتب وإصدار خطة
 * وتجاوز وتصحيح مستلم وترحيلين، ونور في فرع واحد. المبالغ محسوبة باليد من القواعد:
 * بند ١ بتجاوز 15% على 100.000 = 15.000، بند ٢ بلقطة 5% على 50.000 = 2.500، بيع 10% على 40.000
 * بعد المرتجع = 4.000، وبند نور 10% على 20.000 = 2.000.
 *
 * @returns صفوف الشهر لكل الموظفات
 */
export function octoberRows(): StatementMonthRows {
  return {
    lines: octoberLines(),
    ...octoberSalesAndTips(),
    ...octoberPlanning(),
    ...octoberAdjustments(),
  };
}
