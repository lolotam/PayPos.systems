import type { CommissionCalc } from '../commission-types.ts';
import type {
  CommissionPackageSale,
  CommissionPeriodInput,
  CommissionPlanVersion,
  PeriodCommissionLine,
} from '../plan-types.ts';

/**
 * يصنع حساب نسبة اصطناعياً للاختبارات؛ القيمة bps وليست وحدات Percentage.
 *
 * @param value نسبة الاختبار الصحيحة
 * @returns حساب قابل لإعادة الاستخدام في مدخلات الاختبار فقط
 */
export const pct = (value: bigint): CommissionCalc => ({ kind: 'PCT', value });

/**
 * يصنع حساباً ثابتاً اصطناعياً لا يشتق منه أي توقع.
 *
 * @param value مبلغ الاختبار بالفلس
 * @returns حساب ثابت لمدخلات الاختبار
 */
export const fixed = (value: bigint): CommissionCalc => ({ kind: 'FIXED', value });

/**
 * يصنع إصداراً اصطناعياً؛ الافتراضي عشرة بالمئة من النصيب بلا شرائح أو بيع باقة.
 *
 * @param patch الحقول التي يحددها سيناريو الاختبار
 * @returns مدخل إصدار خطة، لا نتيجة محسوبة
 */
export function version(patch: Partial<CommissionPlanVersion> = {}): CommissionPlanVersion {
  return {
    employeeId: 'employee-a',
    effectiveFrom: '2026-10-01',
    wholePeriod: false,
    createdAt: 1n,
    version: 1n,
    base: { enabled: true, calc: pct(1000n) },
    tiers: { enabled: false },
    packageSale: { enabled: false },
    ...patch,
  };
}

/**
 * يصنع إسقاط بند اصطناعياً؛ التواريخ محسومة ولا توجد بيانات أشخاص حقيقية.
 *
 * @param patch تغيير مدخلات السيناريو عن بند افتراضي بنصيب مئة دينار
 * @returns بند نشط لموظفة واحدة
 */
export function line(patch: Partial<PeriodCommissionLine> = {}): PeriodCommissionLine {
  return {
    employeeId: 'employee-a',
    serviceId: 'service-a',
    lineId: 'a',
    occurredAt: 1n,
    recordedAt: 1n,
    businessDate: '2026-10-10',
    netShare: 100000n,
    shareBps: 10000n,
    counts: true,
    ruleSnapshot: { kind: 'FOLLOW_PLAN' },
    ...patch,
  };
}

/**
 * يصنع مدخل بيع اصطناعياً للبائعة لا يدخل المجمّع.
 *
 * @param patch قيم البيع والمرتجع التي يحددها الاختبار
 * @returns إسقاط بيع نشط
 */
export function sale(patch: Partial<CommissionPackageSale> = {}): CommissionPackageSale {
  return {
    saleId: 'sale-a',
    sellerEmployeeId: 'employee-a',
    businessDate: '2026-10-10',
    pricePaid: 100000n,
    refundedAmount: 0n,
    ...patch,
  };
}

/**
 * يجمع مدخلات أكتوبر الاصطناعية؛ التوقعات تبقى أرقاماً حرفية في ملفات الاختبار.
 *
 * @param patch مدخلات السيناريو المختلف عليها فقط
 * @returns فترة موظفة واحدة بدون قاعدة بيانات
 */
export function period(patch: Partial<CommissionPeriodInput> = {}): CommissionPeriodInput {
  return {
    employeeId: 'employee-a',
    period: '2026-10',
    periodLastDay: '2026-10-31',
    lines: [],
    sales: [],
    versions: [version()],
    overrides: [],
    salaries: [],
    ...patch,
  };
}
