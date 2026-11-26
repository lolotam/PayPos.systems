import type { RatingAveragesQuery, RatingsListQuery } from '@pospay/contracts';

/**
 * فلاتر الشاشة كما اختارها المستخدم؛ السلسلة الفارغة معناها «الكل». `month` فارغ (null) معناه «لسه ما اخترتش»: الشهر وقتها
 * هو اللي الخادم سمّاه في رد المتوسطات (شهر النشاط الحالي بتوقيت النشاط)، والمتصفح ما بيخمّنش شهر ولا توقيت.
 */
export interface RatingsFilters {
  branchId: string;
  employeeId: string;
  month: string | null;
}

/** نوع العقد بعد استخراجه بلا `undefined` صريح: العميل المولَّد بيرفض `undefined` على مفتاح اختياري. */
type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/**
 * ما تبعته الشاشة للمسارين لتحديد الفترة: الشهر `YYYY-MM` (اختياري) والفرع (اختياري). الـAPI هو اللي يحوّل الشهر لنافذة
 * لحظات بتوقيت النشاط (D-B12)، فالمتصفح ما بيحسبش `from` ولا `to` ولا يختار توقيتًا.
 */
export type RatingsPeriodQuery = Defined<Pick<RatingAveragesQuery, 'branch_id' | 'month'>>;

/** طلب صفحة القائمة: مفاتيح العقد، والشاشة نفسها ما تحسبش `from`/`to` (D-B12)؛ الفحص بس بيبعتهما. */
export type RatingsPageQuery = Defined<
  Pick<RatingsListQuery, 'branch_id' | 'month' | 'employee_id' | 'cursor' | 'from' | 'to'>
> &
  Pick<RatingsListQuery, 'limit'>;

/** الفترة المعروفة الشهر للقائمة؛ بلا شهر ما فيش قراءة قائمة. */
export type RatingsListRange = RatingsPeriodQuery & { month: string };

export function initialRatingsFilters(): RatingsFilters {
  return { branchId: '', employeeId: '', month: null };
}

/**
 * الموظفة المختارة بشرط إنها لسه ضمن خيارات القائمة المعروضة؛ غير كده «الكل» (السلسلة الفارغة). كده الخانة المعروضة والطلب
 * اللي بيتبعت بيتفقوا دايمًا حتى لو الخيارات اختفت (فشل قراءة المتوسطات) والاختيار القديم لسه محفوظ.
 *
 * @param selected معرّف الموظفة المختارة (فارغ = الكل)
 * @param employees الموظفات اللي ظاهرة كخيارات حاليًا
 * @returns المعرّف المختار لو متاح كخيار، وإلا سلسلة فارغة
 */
export function availableEmployeeId(
  selected: string,
  employees: readonly { employee_id: string }[],
): string {
  return employees.some((employee) => employee.employee_id === selected) ? selected : '';
}

/** طلب المتوسطات: الشهر لو اختاره المستخدم، وإلا بلا شهر فيرد الخادم بشهره الافتراضي. */
export function averagesQuery(filters: RatingsFilters): RatingsPeriodQuery {
  return {
    ...(filters.branchId ? { branch_id: filters.branchId } : {}),
    ...(filters.month ? { month: filters.month } : {}),
  };
}

/**
 * طلب القائمة: لازم يكون الشهر معروف (اختاره المستخدم أو سمّاه الخادم)، وإلا null والقائمة ما بتقرأش.
 *
 * @param filters الفلاتر الحالية
 * @param month الشهر المعروف للشاشة (المختار أو اللي سمّاه الخادم)
 * @returns الفترة بشهرها، أو null لو الشهر لسه مجهول
 */
export function listRange(filters: RatingsFilters, month: string | null): RatingsListRange | null {
  return month ? { ...(filters.branchId ? { branch_id: filters.branchId } : {}), month } : null;
}
