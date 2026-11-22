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
