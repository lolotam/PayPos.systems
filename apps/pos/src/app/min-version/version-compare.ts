/**
 * إصدار التطبيق بعد تقسيمه: الأرقام التلاتة، والـ patch الناقص يعني صفر.
 *
 * الأرقام من `number` مش `bigint`: الإصدار ده رقم إصدار مش فلوس ولا وقت، والقيمة
 * القصوى أرقام التطبيق الفعلية صغيرة جداً.
 */
export interface ParsedAppVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

// `MAJOR.MINOR` أو `MAJOR.MINOR.PATCH` وأرقام بس: أي حاجة تانية مش مقروءة.
const VERSION_PATTERN = /^(\d+)\.(\d+)(?:\.(\d+))?$/;

/**
 * بيقرأ نص إصدار التطبيق.
 *
 * @param raw نص زي «1.3» أو «1.3.0»
 * @returns الأرقام، أو null لو النص مش مقروء
 */
export function parseAppVersion(raw: string): ParsedAppVersion | null {
  const match = VERSION_PATTERN.exec(raw);
  if (match === null) return null;
  const major = Number(match[1] ?? '');
  const minor = Number(match[2] ?? '');
  const patch = match[3] === undefined ? 0 : Number(match[3]);
  // رقم أكبر من حد الأمان مش إصدار حقيقي، وهو كمان مش نص مقروء.
  if (![major, minor, patch].every((part) => Number.isSafeInteger(part) && part >= 0)) return null;
  return { major, minor, patch };
}

/**
 * بيقارن الإصدار المثبّت بالحد الأدنى المطلوب.
 *
 * `1.3` و`1.3.0` نفس النسخة، لأن الـ patch الناقص يعني صفر.
 *
 * @param installed إصدار التطبيق المثبّت
 * @param minimum الحد الأدنى المطلوب
 * @returns true لو الإصدار المثبّت أقل من الحد الأدنى
 */
export function isVersionBelowMinimum(installed: string, minimum: string): boolean {
  const current = parseAppVersion(installed);
  const required = parseAppVersion(minimum);
  // إصدار مش مقروء: مش هنمنع التطبيق من الفتح (FR-007).
  if (current === null || required === null) return false;
  if (current.major !== required.major) return current.major < required.major;
  if (current.minor !== required.minor) return current.minor < required.minor;
  return current.patch < required.patch;
}

// المضيفين المسموح لصفحة المتجر: الـ app store بتاع Apple، وTestFlight، وPlay.
const STORE_HOSTS: readonly string[] = [
  'apps.apple.com',
  'testflight.apple.com',
  'play.google.com',
];

/**
 * بيتأكد إن لينك المتجر آمن قبل ما أي زرار يفتحه.
 *
 * الملف اللي اتخانق ممكن يتحطّ فيه أي لينك، فالمضيف المسموح بس هو اللي بيتفتح
 * (FR-008) —/https والمضيف نفسه بالظبط، من غير نطاقات فرعية.
 *
 * @param raw لينك المتجر زي ما جا في الملف
 * @returns true لو اللينك مسموح
 */
export function isAllowedStoreUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return STORE_HOSTS.includes(url.hostname);
}
