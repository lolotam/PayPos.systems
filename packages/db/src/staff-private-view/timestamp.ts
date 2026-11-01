import { sql, type SQL } from 'drizzle-orm';

/**
 * يسلّم postgres-js اللحظة نص ISO بنوع صريح.
 * الخامة دي ما بتسلسلش كائن Date جواه المعاملات، فأي Date في قالب SQL خام بيقع وقت التنفيذ.
 *
 * @param value اللحظة المراد تمريرها
 * @returns عبارة SQL تحوّل النص إلى timestamptz
 */
export function timestamp(value: Date): SQL {
  return sql`${value.toISOString()}::timestamptz`;
}

/**
 * يحوّل توقيتاً مقروءاً من execute خام إلى Date؛ القراءة ممكن ترجع نص.
 *
 * @param value التوقيت كما وصل من القاعدة
 * @returns نفس اللحظة كـ Date
 */
export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
