/** كود عمود في تطبيق الموظفات — نفس StaffColumnCode في العقد (spec 060 D-A7). */
export type StaffColumnCode =
  | 'date'
  | 'time'
  | 'service'
  | 'customer_name'
  | 'list_price'
  | 'discount'
  | 'net'
  | 'share'
  | 'estimated_commission'
  | 'tip'
  | 'rating_average';

/** كل أكواد أعمدة تطبيق الموظفات (spec 060 D-A7)، بنفس ترتيب الـ enum في العقد. */
export const STAFF_COLUMN_CODES: readonly StaffColumnCode[] = [
  'date',
  'time',
  'service',
  'customer_name',
  'list_price',
  'discount',
  'net',
  'share',
  'estimated_commission',
  'tip',
  'rating_average',
];

/** افتراضي MY-Q3 (PP-18.3): شغلها وفلوسها بس، من غير السعر والخصم والصافي. */
export const DEFAULT_STAFF_COLUMNS: readonly StaffColumnCode[] = [
  'date',
  'time',
  'service',
  'customer_name',
  'share',
  'estimated_commission',
  'tip',
  'rating_average',
];

/** أكواد موجودة في الـ enum بس مستخبية لحد ما التقييم يرجع (RT-Q1، D-A7)؛ 61-3 بتشيلها من هنا. */
const POSTPONED_COLUMNS: ReadonlySet<StaffColumnCode> = new Set<StaffColumnCode>([
  'rating_average',
]);

/** افتراضي MY-Q9 (PP-21.1): الشهر الحالي بس. */
export const DEFAULT_STAFF_MONTHS_BACK = 1;
const MAX_STAFF_MONTHS_BACK = 24;

const KNOWN: ReadonlySet<string> = new Set(STAFF_COLUMN_CODES);

/**
 * بيرجّع الأكواد اللي تمنع حفظ مجموعة الأعمدة: كود مش معروف، أو مكرر، أو مستخبي لحد ما التقييم يرجع.
 * القاعدة: المدير بيختار من الأكواد المعروضة بس، وrating_comments وcustomer_phone مش أكواد أصلاً (S-9، S-12، D-A7).
 *
 * @param codes الأكواد زي ما المدير بعتها
 * @returns الأكواد المرفوضة بترتيب أول ظهور ومن غير تكرار؛ فاضية = المجموعة مقبولة
 */
export function invalidStaffColumns(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  const invalid = new Set<string>();
  for (const code of codes) {
    const offered = KNOWN.has(code) && !POSTPONED_COLUMNS.has(code as StaffColumnCode);
    if (!offered || seen.has(code)) invalid.add(code);
    seen.add(code);
  }
  return [...invalid];
}

/**
 * بيحدد هل عدد الشهور اللي المدير اختاره مسموح.
 * القاعدة: من 1 لـ 24 شهر، والشهر الحالي محسوب منهم (MY-Q9، D-A14).
 *
 * @param monthsBack العدد اللي المدير بعته
 * @returns true لو العدد صحيح وجوه المدى
 */
export function isValidStaffMonthsBack(monthsBack: number): boolean {
  return Number.isInteger(monthsBack) && monthsBack >= 1 && monthsBack <= MAX_STAFF_MONTHS_BACK;
}

/**
 * بيحسب الأعمدة اللي أي قراية «لي» بتسمح بيها فعلاً.
 * القاعدة: المحفوظ، أو افتراضي MY-Q3 لو مفيش؛ والأكواد المستخبية بتتشال دايماً لحد ما التقييم يرجع (FR-A08).
 *
 * @param stored المجموعة المحفوظة، أو null لو المدير ما اختارش
 * @returns الأعمدة المسموحة بترتيب الـ enum
 */
export function effectiveStaffColumns(stored: readonly string[] | null): StaffColumnCode[] {
  const chosen = new Set<string>(stored ?? DEFAULT_STAFF_COLUMNS);
  return STAFF_COLUMN_CODES.filter((code) => chosen.has(code) && !POSTPONED_COLUMNS.has(code));
}

/**
 * بيحسب كام شهر لورا الموظفة تقدر تشوف في «شغلي» و«حضوري».
 * القاعدة: المحفوظ، أو الشهر الحالي بس لو المدير ما اختارش (MY-Q9، D-A14).
 *
 * @param stored العدد المحفوظ، أو null
 * @returns عدد الشهور، والشهر الحالي منهم
 */
export function effectiveStaffMonthsBack(stored: number | null): number {
  return stored ?? DEFAULT_STAFF_MONTHS_BACK;
}
