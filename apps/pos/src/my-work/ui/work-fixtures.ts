import type { OwnCommissionCorrection, OwnCommissionEstimate } from '@pospay/contracts';

export const LINE_1 = '00000000-0000-4000-8000-000000000001';
export const LINE_2 = '00000000-0000-4000-8000-000000000002';
export const LINE_3 = '00000000-0000-4000-8000-000000000003';

/** صف كامل: كل الأعمدة مسموحة. */
export const fullLine = {
  line_id: LINE_1,
  branch_name_ar: 'Main branch AR',
  branch_name_en: 'Main branch',
  cancelled: false,
  date: '2026-11-20',
  late: false,
  time: '2026-11-20T10:30:00Z',
  service_name_ar: 'Haircut AR',
  service_name_en: 'Haircut',
  customer_name: 'Customer One',
  list_price: '10.000',
  discount: '1.000',
  net: '9.000',
  share_bps: 5000,
};

/** صف خدمة اتلغت، بنفس الأعمدة. */
export const cancelledLine = {
  ...fullLine,
  line_id: LINE_2,
  service_name_ar: 'Colour AR',
  service_name_en: 'Colour',
  cancelled: true,
  cancelled_at: '2026-11-21T09:00:00Z',
};

/** صف الأعمدة المخفية غايبة منه: الصافي بس، ومفيش عمود تاني. */
export const netOnlyLine = {
  line_id: LINE_3,
  branch_name_ar: null,
  branch_name_en: 'Main branch',
  cancelled: false,
  net: '4.500',
};

export const linesPage = (
  items: unknown[],
  next: string | null = null,
  month = '2026-11',
  timeZone = 'Asia/Kuwait',
) => ({
  items,
  next_cursor: next,
  month,
  time_zone: timeZone,
});
export const visibleTips = (month = '2026-11') => ({
  month,
  status: 'VISIBLE',
  total_cash: '12.500',
  total_card: '7.250',
});
export const hiddenTips = (month = '2026-11') => ({ month, status: 'HIDDEN' });
export const visibleRating = (average: string | null, count: number) => ({
  visibility: 'VISIBLE' as const,
  average,
  count,
});
export const hiddenRating = () => ({ visibility: 'HIDDEN' as const });

export const hiddenEstimate = (): OwnCommissionEstimate => ({ status: 'HIDDEN' });
/** تقدير مفتوح: مجموع 6.750 وعمولة 4.250 للبند الأول و2.500 للبند التاني (الملغي). */
export const openEstimate = (recalculated = false): OwnCommissionEstimate => ({
  status: 'ESTIMATE',
  total: '6.750',
  per_line: [
    { line_id: LINE_1, amount: '4.250' },
    { line_id: LINE_2, amount: '2.500' },
  ],
  corrections: [],
  recalculated,
});
export const lineCorrection = (): OwnCommissionCorrection => ({
  kind: 'LINE',
  source_period: '2026-10',
  business_date: '2026-10-15',
  service_name_ar: 'Shampoo AR',
  service_name_en: 'Shampoo',
  previous_amount: '3.000',
  new_amount: '1.500',
  amount: '-1.500',
});
export const saleCorrection = (): OwnCommissionCorrection => ({
  kind: 'SALE',
  source_period: '2026-09',
  business_date: null,
  service_name_ar: null,
  service_name_en: null,
  previous_amount: '2.000',
  new_amount: '2.750',
  amount: '0.750',
});
export const noPlanEstimate = (
  corrections: OwnCommissionCorrection[] = [],
): OwnCommissionEstimate => ({ status: 'NO_PLAN', corrections });
export const noSalaryEstimate = (
  corrections: OwnCommissionCorrection[] = [],
): OwnCommissionEstimate => ({ status: 'NO_SALARY', corrections });
export const approvedEstimate = (
  corrections: OwnCommissionCorrection[] = [],
): OwnCommissionEstimate => ({ status: 'APPROVED', total: '8.125', corrections });
