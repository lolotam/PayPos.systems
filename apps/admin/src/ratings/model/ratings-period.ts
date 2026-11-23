const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const FIRST_MONTH_YEAR = 2000;
const LAST_MONTH_YEAR = 2999;

/**
 * يقبل شهرًا كاملًا بصيغة `YYYY-MM` وبسنة معقولة فقط (2000 إلى 2999، نفس حدود عقد `month` في الـAPI). المتصفح الذي لا يدعم
 * حقل الشهر يعرضه كنص عادي، فالقيمة الجزئية أو الغلط (`2026-` أو `abc`) لازم ما توصلش للطلب.
 *
 * @param value النص كما كتبه المستخدم أو اختاره المتصفح
 * @returns الشهر نفسه لو صالح، وإلا null
 */
export function parseRatingsMonth(value: string): string | null {
  const year = Number(MONTH_PATTERN.exec(value)?.[1]);
  return year >= FIRST_MONTH_YEAR && year <= LAST_MONTH_YEAR ? value : null;
}
