import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { createAuthDatabase } from '@pospay/db';
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';

/**
 * ما يحتاجه Better Auth: الـ pool على pospay_auth، السر، العنوان، الـ origins المسموحة، ومولّد الـ ids.
 */
export interface AuthOptions {
  /** AUTH_DATABASE_URL — pospay_auth; the pool is opened here and never leaves this package. */
  readonly databaseUrl: string;
  /** BETTER_AUTH_SECRET — بيوقّع الـ cookies ويشفّر سر الـ TOTP؛ 32 حرف على الأقل. */
  readonly secret: string;
  /** العنوان العام للـ API (https://api.example.com) — الـ auth تحت /v1/auth. */
  readonly baseURL: string;
  /** الـ origins اللي تقدر تبعت requests بالـ cookie (الـ admin والـ POS). */
  readonly trustedOrigins: readonly string[];
  readonly ids: { newId(): string };
  /** true في production: cookies بـ Secure. */
  readonly secureCookies: boolean;
  /** الدومين الأب اللي الـ session cookie بيتشارك عليه بين app. و api. (ADR-0001 §3)؛ من غيره الـ cookie host-only. */
  readonly cookieDomain?: string | undefined;
  /** بيستقبل أحداث Better Auth بعد التنضيف — من غير الـ error objects اللي ممكن تشيل tokens. */
  readonly onLog: (entry: AuthLogEntry) => void;
}

/**
 * حدث log من Better Auth بعد ما شلنا منه أي حاجة ممكن تبقى سر: الرسالة متنضّفة، والـ errors
 * بيتبقى منها اسم الـ class بس — رسالة خطأ Drizzle فيها الـ SQL params، يعني الـ session token.
 */
export interface AuthLogEntry {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly errorNames: readonly string[];
}

export const AUTH_BASE_PATH = '/v1/auth';

/**
 * الـ session اللي اتأكدنا منها — الـ ids بس، ومفيش token.
 */
export interface VerifiedSession {
  readonly userId: string;
  readonly sessionId: string;
  /** الـ Set-Cookie اللي Better Auth طلّعها وهو بيجدد الـ session — لازم توصل للمتصفح وإلا الـ cookie يخلص في ميعاده القديم. */
  readonly setCookies: readonly string[];
}

/**
 * واجهة الـ auth للباقي: الـ HTTP handler، التحقق من session، وإنشاء مستخدم من ناحية السيرفر.
 * Better Auth نفسه بيفضل جوه الـ package دي — مفيش package تاني بيشوف أنواعه.
 */
export interface AuthService {
  /** بيرد على /v1/auth/* (sign-in، sign-out، الـ TOTP…). */
  handler(request: Request): Promise<Response>;
  /** بيرجّع الـ session لو الـ cookie صالح (ومعاها cookies التجديد)، وإلا null. */
  getSession(headers: Headers): Promise<VerifiedSession | null>;
  /** بيعمل مستخدم بباسورد — للسكريبت بتاع الـ operator بس (التسجيل مقفول). */
  provisionUser(input: { email: string; name: string; password: string }): Promise<string>;
  /** /ready: the pool answers AND it is pospay_auth. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

/**
 * بيبني Better Auth بالشكل اللي ADR-0003 قرّره: email + password والـ TOTP بس، والتسجيل مقفول (§6) —
 * المستخدمين بيتعملوا من السكريبت بتاع الـ operator. مفيش organization plugin: الصلاحيات في memberships بتاعتنا.
 *
 * الـ role بيتأكد قبل ما الـ service ترجع: URL بصلاحيات تانية (الـ owner مثلاً) عمره ما بيخدم login.
 *
 * @param options الـ URL بتاع pospay_auth والسر والعنوان والـ origins ومولّد الـ ids ومستقبل الـ logs
 * @returns الـ AuthService، بعد ما الاتصال اتأكد إنه pospay_auth
 */
export async function createAuth(options: AuthOptions): Promise<AuthService> {
  if (options.secret.length < 32)
    throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
  const database = createAuthDatabase({ url: options.databaseUrl });
  try {
    await database.ping();
  } catch (error) {
    await database.close();
    throw error;
  }
  const auth = buildBetterAuth(options, database);
  return {
    handler: (request) => auth.handler(request),
    getSession: async (headers) => {
      const { headers: out, response } = await auth.api.getSession({
        headers,
        returnHeaders: true,
      });
      if (response === null) return null;
      return {
        userId: response.user.id,
        sessionId: response.session.id,
        setCookies: out.getSetCookie(),
      };
    },
    provisionUser: async (input) => {
      const context = await auth.$context;
      const { minPasswordLength, maxPasswordLength } = context.password.config;
      if (input.password.length < minPasswordLength || input.password.length > maxPasswordLength) {
        throw new RangeError(
          `password must be ${minPasswordLength}–${maxPasswordLength} characters`,
        );
      }
      const hash = await context.password.hash(input.password);
      // 'admin': provisioned by an operator, not by the user signing up.
      const user = await context.internalAdapter.createUser(
        { email: input.email.toLowerCase(), name: input.name, emailVerified: true },
        { method: 'admin' },
      );
      await context.internalAdapter.linkAccount({
        userId: user.id,
        providerId: 'credential',
        accountId: user.id,
        password: hash,
      });
      return user.id;
    },
    ping: () => database.ping(),
    close: () => database.close(),
  };
}

function buildBetterAuth(options: AuthOptions, database: ReturnType<typeof createAuthDatabase>) {
  return betterAuth({
    appName: 'PosPay',
    baseURL: options.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: options.secret,
    trustedOrigins: [...options.trustedOrigins],
    database: drizzleAdapter(database.db, { provider: 'pg', schema: database.schema }),
    // Sign-up is closed (ADR-0003 §6): users are provisioned server-side by the operator script.
    emailAndPassword: { enabled: true, disableSignUp: true },
    session: {
      additionalFields: {
        // A hint only, re-verified against memberships on every request (ADR-0003 §4.1); never client input.
        activeCompanyId: { type: 'string', required: false, input: false },
      },
    },
    plugins: [twoFactor({ issuer: 'PosPay' })],
    advanced: {
      cookiePrefix: 'pospay',
      useSecureCookies: options.secureCookies,
      // Better Auth skips origin/callback checks when NODE_ENV is test; pinned on so tests run what production runs.
      disableOriginCheck: false,
      ...(options.cookieDomain === undefined
        ? {}
        : { crossSubDomainCookies: { enabled: true, domain: options.cookieDomain } }),
      // UUID v7 for every row, as everywhere else (CLAUDE.md §5); the columns are uuid.
      database: { generateId: () => options.ids.newId() },
    },
    telemetry: { enabled: false },
    // Without a log function Better Auth writes to console.* with the raw error, SQL params included.
    logger: {
      level: 'warn',
      log: (level, message, ...args) => options.onLog(toLogEntry(level, message, args)),
    },
  });
}

// Better Auth's messages are a fixed phrase, then ": " and a value (a URL, an origin, an id). Only the phrase
// survives, and only when it is plain words: no digit, no URL character, no word long enough to be a token.
const PHRASE = /^[A-Za-z][A-Za-z '()_-]{0,99}$/;
const LONG_WORD = /[A-Za-z_]{16,}/g;

function toLogEntry(
  level: AuthLogEntry['level'],
  message: unknown,
  args: readonly unknown[],
): AuthLogEntry {
  const phrase = typeof message === 'string' ? (message.split(':')[0] ?? '').trim() : '';
  const safe =
    PHRASE.test(phrase) && (phrase.match(LONG_WORD) ?? []).every((word) => /^[A-Z_]+$/.test(word));
  const text = safe ? phrase : '[withheld]';
  const errorNames = [message, ...args]
    .filter((value): value is Error => value instanceof Error)
    .map((error) => error.name);
  return { level, message: text, errorNames };
}
