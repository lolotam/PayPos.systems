/**
 * بوابة تفعيل مسارات شريحة 076 (plan §1.1): مفيش مسار من الشريحة دي يوصل في الإنتاج قبل
 * ما الأجزاء الخمسة تتدمج. القيمة بتتقرأ مرة واحدة عند الإقلاع، والقيمة الافتراضية مقفولة.
 */
export const STAFF_ACCESS_ROUTES = Symbol('STAFF_ACCESS_ROUTES');

/**
 * بيقول إن مسارات الشريحة مفعّلة ولا لأ.
 *
 * @param env بيئة العملية
 * @returns true بس لما STAFF_ACCESS_ROUTES=on
 */
export function staffAccessRoutesEnabled(env: NodeJS.ProcessEnv): boolean {
  return env['STAFF_ACCESS_ROUTES'] === 'on';
}
