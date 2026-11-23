import { SECURE_COOKIE_PREFIX } from 'better-auth/cookies/utils';

/**
 * البادئة الافتراضية لاسم cookies الجلسة — Better Auth بيبني الاسم `pospay.session_token` من غيرها.
 * كل بيئة بتاخد بادئة مختلفة، عشان cookie من بيئة ما يتقراش كجلسة في environment تانية.
 */
export const DEFAULT_AUTH_COOKIE_PREFIX = 'pospay';

/** شكل البادئة المسموح: حرف صغير في الأول، وبعده حروف صغيرة أو أرقام أو شرطات (من 2 لـ 31 حرف). */
export const AUTH_COOKIE_PREFIX_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;

export interface SessionCookieNames {
  /** البادئة اللي Better Auth بيبني بيها أسماء الـ cookies. */
  readonly prefix: string;
  /** اسم الـ session cookie العادي — زي ما Better Auth بيكتبه، بـ `__Secure-` لو الـ cookies Secure. */
  readonly normal: string;
}

/**
 * أسماء cookies الجلسة العادية من بادئة واحدة — Better Auth بيبني الأسماء من `prefix`، والـ API بيقرا
 * الاسم ده عشان يفرق بين جلسة الأدمن والجلسة العادية. البادئة الفاضية معناها الافتراضي، واللي مش
 * على الشكل المسموح بيوقف العملية بدل ما يبني اسم cookie غريب.
 *
 * @param options البادئة المهيّأة (`cookiePrefix` فاضية = الافتراضي) وهل الـ cookies Secure
 * @returns البادئة واسم الـ session cookie العادي
 */
export function sessionCookieNames(options: {
  readonly cookiePrefix?: string | undefined;
  readonly secureCookies: boolean;
}): SessionCookieNames {
  const prefix = options.cookiePrefix ?? DEFAULT_AUTH_COOKIE_PREFIX;
  if (!AUTH_COOKIE_PREFIX_PATTERN.test(prefix))
    throw new Error(`AUTH_COOKIE_PREFIX must match ${AUTH_COOKIE_PREFIX_PATTERN.source}`);
  return {
    prefix,
    normal: `${options.secureCookies ? SECURE_COOKIE_PREFIX : ''}${prefix}.session_token`,
  };
}
