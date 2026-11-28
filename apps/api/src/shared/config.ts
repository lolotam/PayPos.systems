import { isIP } from 'node:net';
import { AUTH_COOKIE_PREFIX_PATTERN, DEFAULT_AUTH_COOKIE_PREFIX } from '@pospay/auth';
import { LOG_LEVELS } from '@pospay/observability';
import { z } from 'zod';
import { matchesTrustedOrigin } from './trusted-origin-pattern.ts';

// Read once at startup; a missing or malformed value stops the process instead of failing later.
const trustedProxies = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().refine(validProxy)));

function validProxy(value: string): boolean {
  const parts = value.split('/');
  const version = isIP(parts[0] ?? '');
  if (version === 0 || parts.length > 2) return false;
  const prefix = parts[1];
  return (
    prefix === undefined ||
    (/^\d{1,3}$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128))
  );
}

// أصل HTTP واحد: بروتوكول http أو https، من غير مسار ولا استعلام ولا بيانات اعتماد. نفس قواعد
// صفحة التقييم، والنتيجة ما بتتسربش في رسالة الخطأ لأن readConfig بيسمّي المفاتيح بس.
function isSingleHttpOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return /^https?:$/.test(url.protocol) && url.origin === origin;
  } catch {
    return false;
  }
}

function isCorsOrigin(origin: string): boolean {
  return origin === 'capacitor://localhost' || (!/[*?]/.test(origin) && isSingleHttpOrigin(origin));
}

const schema = z.object({
  PLATFORM_NOTIFICATIONS_DATABASE_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .url({ protocol: /^postgres(ql)?$/ })
      .optional()
      .catch(undefined),
  ),
  TRUSTED_PROXY_CIDRS: trustedProxies,
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // This process's pospay_app pool. An empty value is unset; the default is 10.
  DATABASE_POOL_MAX: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().min(1).max(100).default(10),
  ),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // pospay_auth — Better Auth's own pool, opened inside packages/auth (ADR-0003 §2.1).
  AUTH_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Signs session cookies and encrypts TOTP secrets.
  BETTER_AUTH_SECRET: z.string().min(32),
  // The API's public URL; https makes the cookies Secure.
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
  // Comma-separated origins allowed by Better Auth's trustedOrigins (admin, POS).
  AUTH_TRUSTED_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ''),
    ),
  // Optional Fastify CORS allow-list; empty defaults to AUTH_TRUSTED_ORIGINS so native apps can receive CORS
  // without widening Better Auth's session origin trust (#669). Exact origins only (http(s) or capacitor://localhost).
  API_CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ''),
    )
    .pipe(z.array(z.string().refine(isCorsOrigin))),
  RATING_PAGE_ORIGIN: z
    .string()
    .trim()
    .default('')
    .refine((origin) => origin === '' || isSingleHttpOrigin(origin)),
  // أصل لوحة الإدارة بالاسم (AC-ACT-21): رابط دعوة العضو بيتبني عليه. فاضي = مسار الدعوة ما
  // يتركبش (NOT_READY)، ومضبوط لازم يكون من الأصول الموثوقة نفسها.
  ADMIN_ORIGIN: z
    .string()
    .trim()
    .default('')
    .refine((origin) => origin === '' || isSingleHttpOrigin(origin)),
  // The parent domain the session cookie is shared on (.pospay.systems, .staging.pospay.systems — ADR-0001 §3, §6).
  // Unset in local development: the cookie stays host-only.
  COOKIE_DOMAIN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^\.[a-z0-9-]+(\.[a-z0-9-]+)+$/)
      .optional(),
  ),
  // The prefix of the session cookie name — one per environment, so a production cookie is never read by a
  // staging host (ADR-0001 §3). Unset: the default prefix, the name production uses today.
  AUTH_COOKIE_PREFIX: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().regex(AUTH_COOKIE_PREFIX_PATTERN).default(DEFAULT_AUTH_COOKIE_PREFIX),
  ),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  // Validated here so an invalid value never reaches pino, whose error message would print it.
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export type ApiConfig = z.output<typeof schema>;

/**
 * الأصل الصريح لازم يكون من الأصول الموثوقة نفسها (AC-ACT-21): رابط الدعوة ما يبنيش على أصل
 * موثوق تاني. الأصل الفاضي معناه إن مسار الدعوة ما يتركبش أصلًا.
 *
 * @param config الإعداد المقروء
 * @returns true لما الأصل فاضي أو مغطّى بنمط موثوق
 */
function adminOriginIsTrusted(config: ApiConfig): boolean {
  if (config.ADMIN_ORIGIN === '') return true;
  return config.AUTH_TRUSTED_ORIGINS.some((pattern) =>
    matchesTrustedOrigin(config.ADMIN_ORIGIN, pattern),
  );
}

const hostOf = (origin: string): string =>
  new URL(origin).hostname.toLowerCase().replace(/\.+$/, '');

function isUnderCookieDomain(origin: string, cookieDomain: string | undefined): boolean {
  if (origin === '' || cookieDomain === undefined) return false;
  const domain = cookieDomain.slice(1).toLowerCase();
  const hostname = hostOf(origin);
  const domains = domain.endsWith('.pospay.systems') ? [domain, 'pospay.systems'] : [domain];
  return domains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}

/**
 * يرجّع قائمة مصادر CORS للـ API: يستعمل API_CORS_ORIGINS لو مضبوطة وإلا يقع على AUTH_TRUSTED_ORIGINS (#669).
 *
 * @param config الإعداد المقروء أو حقول المصادر الخاصة به
 * @returns قائمة المصادر المسموح بها في CORS
 */
export function corsOriginsFrom(
  config: Pick<ApiConfig, 'API_CORS_ORIGINS' | 'AUTH_TRUSTED_ORIGINS'>,
): string[] {
  return config.API_CORS_ORIGINS.length > 0 ? config.API_CORS_ORIGINS : config.AUTH_TRUSTED_ORIGINS;
}

/**
 * Parses the API's environment. The error names the missing keys but never echoes a value — the URLs
 * carry passwords.
 *
 * @param env the process environment
 * @returns the validated configuration
 */
export function readConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const result = schema
    .refine(
      (config) =>
        !config.RATING_PAGE_ORIGIN.startsWith('http:') ||
        env.NODE_ENV === 'development' ||
        env.NODE_ENV === 'test',
      { path: ['RATING_PAGE_ORIGIN'] },
    )
    .refine(
      (config) =>
        config.RATING_PAGE_ORIGIN === '' ||
        (hostOf(config.RATING_PAGE_ORIGIN) !== hostOf(config.BETTER_AUTH_URL) &&
          !config.AUTH_TRUSTED_ORIGINS.some((pattern) =>
            matchesTrustedOrigin(config.RATING_PAGE_ORIGIN, pattern),
          ) &&
          !config.API_CORS_ORIGINS.includes(config.RATING_PAGE_ORIGIN)),
      {
        path: ['RATING_PAGE_ORIGIN'],
        // نفحص العلاقة بعد صلاحية القيم حتى لا يكشف استثناء URL إعدادًا غير صالح.
        when: (payload) => {
          const v = payload.value as { AUTH_TRUSTED_ORIGINS?: unknown; API_CORS_ORIGINS?: unknown };
          return (
            schema
              .pick({ BETTER_AUTH_URL: true, RATING_PAGE_ORIGIN: true })
              .safeParse(payload.value).success &&
            Array.isArray(v.AUTH_TRUSTED_ORIGINS) &&
            Array.isArray(v.API_CORS_ORIGINS)
          );
        },
      },
    )
    .refine((config) => !isUnderCookieDomain(config.RATING_PAGE_ORIGIN, config.COOKIE_DOMAIN), {
      path: ['RATING_PAGE_ORIGIN'],
      // صفحة التقييم العامة يجب أن تستضيفها دامنة منفصلة عن COOKIE_DOMAIN (#856).
      when: (payload) =>
        schema.pick({ RATING_PAGE_ORIGIN: true, COOKIE_DOMAIN: true }).safeParse(payload.value)
          .success,
    })
    // نفس قاعدة صفحة التقييم: http مسموح في التطوير والاختبار بس.
    .refine(
      (config) =>
        !config.ADMIN_ORIGIN.startsWith('http:') ||
        env.NODE_ENV === 'development' ||
        env.NODE_ENV === 'test',
      { path: ['ADMIN_ORIGIN'] },
    )
    .refine(adminOriginIsTrusted, {
      path: ['ADMIN_ORIGIN'],
      // نفس الحارس: نقيس العلاقة بعد صلاحية القيم حتى لا يكشف استثناء URL إعدادًا غير صالح.
      when: (payload) => schema.pick({ ADMIN_ORIGIN: true }).safeParse(payload.value).success,
    })
    .safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid API configuration: ${keys.join(', ')} — see .env.example`);
  }
  return result.data;
}

/**
 * ربط مسار دعوة العضو بالأصل الصريح (AC-ACT-21): رابط تعيين كلمة المرور بيتبني على `ADMIN_ORIGIN`
 * بعد ما readConfig يتحقق إنه من الأصول الموثوقة، مش على أول أصل موثوق. من غير أصل، المسار ما
 * يتركبش والكنترولر بيرد NOT_READY.
 *
 * @param config الإعداد المقروء
 * @returns تبعيات الدعوة أو كائن فاضي
 */
export function memberInvitationsDependency(config: ApiConfig): {
  readonly memberInvitations?: { readonly adminOrigin: string };
} {
  if (config.ADMIN_ORIGIN === '') return {};
  return { memberInvitations: { adminOrigin: config.ADMIN_ORIGIN } };
}
