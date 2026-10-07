import { randomBytes } from 'node:crypto';

import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { createAuthDatabase, createStaffOtpDatabase } from '@pospay/db';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import { createPersonalSessions, type PersonalSessions } from './personal-sessions.ts';
import { passkeyPolicy, registrationPlugin, isPasskeyRoute } from './passkey-policy.ts';
import { createPasskeyFacade, type ActivePasskeyBindings, type PasskeyFacade } from './passkeys.ts';
import { sessionFromRecord } from './staff-session-fence.ts';
import { createStaffSessions, type StaffSessions } from './staff-sessions.ts';

/**
 * ما يحتاجه Better Auth: الـ pool على pospay_auth، السر، العنوان، الـ origins المسموحة، ومولّد الـ ids.
 */
export interface AuthOptions {
  readonly staffPhoneLockKey: (hash: Uint8Array) => bigint;
  readonly clock?: { now(): Date };
  /** القارئ من staff عبر composition root؛ غيابه يقفل خيارات التسجيل فقط. */
  readonly passkeyBindings?: ActivePasskeyBindings | undefined;
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
// TODO(spec): how long a set-password link lives — Better Auth's reset default (1 h) until decided.
const SET_PASSWORD_LINK_TTL_MS = 60 * 60 * 1000;

/**
 * الـ session اللي اتأكدنا منها — الـ ids بس، ومفيش token.
 */
export interface VerifiedSession {
  readonly userId: string;
  readonly sessionId: string;
  /** الشركة اللي اليوزر اختارها آخر مرة — hint بس، الـ guard بيتأكد من العضوية في كل طلب (ADR-0003 §4.1). */
  readonly activeCompanyId: string | null;
  /** صلاحيات المنصة السارية لليوزر (platform_grants) — مش مرتبطة بشركة. */
  readonly platformPermissions: readonly string[];
  /** الـ Set-Cookie اللي Better Auth طلّعها وهو بيجدد الـ session — لازم توصل للمتصفح وإلا الـ cookie يخلص في ميعاده القديم. */
  readonly setCookies: readonly string[];
}

/**
 * واجهة الـ auth للباقي: الـ HTTP handler، التحقق من session، وإنشاء مستخدم من ناحية السيرفر.
 * Better Auth نفسه بيفضل جوه الـ package دي — مفيش package تاني بيشوف أنواعه.
 */
export interface AuthService {
  readonly staff: StaffSessions;
  readonly personal: PersonalSessions;
  readonly passkeys: PasskeyFacade;
  /** بيرد على /v1/auth/* (sign-in، sign-out، الـ TOTP…). */
  handler(request: Request): Promise<Response>;
  /** بيرجّع الـ session لو الـ cookie صالح (ومعاها cookies التجديد)، وإلا null. */
  getSession(headers: Headers): Promise<VerifiedSession | null>;
  /** بيعمل مستخدم بباسورد — للسكريبت بتاع الـ operator بس (التسجيل مقفول). */
  provisionUser(input: { email: string; name: string; password: string }): Promise<string>;
  /**
   * رابط يستخدمه اليوزر مرة واحدة يحط بيه الباسورد بتاعه — للسكريبت بتاع الـ operator بس. الرابط فيه token، فبيتسلم
   * للـ operator ومبيتكتبش في أي log.
   */
  issuePasswordSetLink(userId: string, redirectTo: string): Promise<string>;
  /** بيمسح يوزر لسه متعمل ومفيش له سجل — التعويض لو خطوة بعد الإنشاء فشلت (createPlatformUser). */
  discardUser(userId: string): Promise<void>;
  /** بيسجل فعل على مستوى المنصة (إنشاء يوزر مثلاً) في platform_audit_log. */
  recordPlatformAction(entry: {
    actor: string;
    action: string;
    targetUserId: string | null;
    details: Record<string, unknown>;
  }): Promise<void>;
  /** /ready: the pool answers AND it is pospay_auth. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

/**
 * بيبني Better Auth: email + password وTOTP، وتسجيل passkey مقيد داخلياً؛ التسجيل العام مقفول (ADR-0003 §6) —
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
  const staff = staffSessions(options, auth, database);
  const personal = personalSessions(options, auth);
  const passkeys = configuredPasskeys(options, auth, database);
  return {
    staff,
    personal,
    passkeys,
    handler: async (request) => {
      if (
        isPasskeyRoute(request.url) ||
        !(await normalPurpose(staff, request.headers, options.onLog))
      )
        return new Response(null, { status: 403 });
      return auth.handler(request);
    },
    getSession: async (headers) => {
      if (!(await normalPurpose(staff, headers, options.onLog))) return null;
      const { headers: out, response } = await auth.api.getSession({
        headers,
        returnHeaders: true,
      });
      if (response === null) return null;
      return {
        platformPermissions: await database.activePlatformPermissions(response.user.id),
        userId: response.user.id,
        sessionId: response.session.id,
        activeCompanyId:
          typeof response.session.activeCompanyId === 'string'
            ? response.session.activeCompanyId
            : null,
        setCookies: out.getSetCookie(),
      };
    },
    provisionUser: async (input) => provision(await auth.$context, input),
    issuePasswordSetLink: async (userId, redirectTo) =>
      issueSetPasswordLink(await auth.$context, userId, redirectTo),
    discardUser: async (userId) => {
      await (await auth.$context).internalAdapter.deleteUser(userId);
    },
    recordPlatformAction: (entry) =>
      database.recordPlatformAction({ id: options.ids.newId(), ...entry }),
    ping: () => database.ping(),
    close: async () => {
      await Promise.all([database.close(), staff.close(), personal.close()]);
    },
  };
}

type AuthContext = Awaited<ReturnType<typeof buildBetterAuth>['$context']>;

async function provision(
  context: AuthContext,
  input: { email: string; name: string; password: string },
): Promise<string> {
  const { minPasswordLength, maxPasswordLength } = context.password.config;
  if (input.password.length < minPasswordLength || input.password.length > maxPasswordLength) {
    throw new RangeError(`password must be ${minPasswordLength}–${maxPasswordLength} characters`);
  }
  const hash = await context.password.hash(input.password);
  // 'admin': provisioned by an operator, not by the user signing up.
  const user = await context.internalAdapter.createUser(
    { email: input.email.toLowerCase(), name: input.name, emailVerified: true },
    { method: 'admin' },
  );
  try {
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: hash,
    });
  } catch (error) {
    // The user row is already committed; without its credential it could never sign in and would block a retry.
    await context.internalAdapter.deleteUser(user.id);
    throw error;
  }
  return user.id;
}

async function issueSetPasswordLink(
  context: AuthContext,
  userId: string,
  redirectTo: string,
): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  // The same verification row Better Auth's own reset flow writes, consumed once by POST /reset-password.
  await context.internalAdapter.createVerificationValue({
    value: userId,
    identifier: `reset-password:${token}`,
    expiresAt: new Date(Date.now() + SET_PASSWORD_LINK_TTL_MS),
  });
  return `${context.baseURL}/reset-password/${token}?callbackURL=${encodeURIComponent(redirectTo)}`;
}

const STAFF_SESSION_FIELDS = {
  purpose: { type: 'string', required: false, input: false },
  staffDeviceContext: { type: 'json', required: false, input: false },
  staffPersonalContext: { type: 'json', required: false, input: false },
  staffAuthenticatedAt: { type: 'date', required: false, input: false },
  staffAbsoluteDeadline: { type: 'date', required: false, input: false },
  // A hint only, re-verified against memberships on every request (ADR-0003 §4.1); never client input.
  activeCompanyId: { type: 'string', required: false, input: false },
} as const;
type StaffAuthConfiguration = BetterAuthOptions & {
  plugins: [ReturnType<typeof twoFactor>, ReturnType<typeof registrationPlugin>];
  session: { additionalFields: typeof STAFF_SESSION_FIELDS };
};

export function buildBetterAuth(
  options: AuthOptions,
  database: ReturnType<typeof createAuthDatabase>,
): ReturnType<typeof betterAuth<StaffAuthConfiguration>> {
  return betterAuth<StaffAuthConfiguration>({
    appName: 'PosPay',
    baseURL: options.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: options.secret,
    trustedOrigins: [...options.trustedOrigins],
    database: drizzleAdapter(database.db, { provider: 'pg', schema: database.schema }),
    // Sign-up is closed (ADR-0003 §6): users are provisioned server-side by the operator script.
    emailAndPassword: { enabled: true, disableSignUp: true },
    session: { additionalFields: STAFF_SESSION_FIELDS },
    plugins: [
      twoFactor({ issuer: 'PosPay' }),
      registrationPlugin(passkeyPolicy(options.baseURL, options.trustedOrigins)),
    ],
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

function staffSessions(
  options: AuthOptions,
  auth: ReturnType<typeof buildBetterAuth>,
  authDatabase: ReturnType<typeof createAuthDatabase>,
): StaffSessions {
  return createStaffSessions({
    database: createStaffOtpDatabase({
      url: options.databaseUrl,
      phoneLockKey: options.staffPhoneLockKey,
    }),
    authDatabase,
    secret: options.secret,
    normalCookie: `${options.secureCookies ? '__Secure-' : ''}pospay.session_token`,
    now: () => options.clock?.now() ?? new Date(),
    primitive: {
      create: async (userId, device, now, deadline) =>
        (await auth.$context).internalAdapter.createSession(
          userId,
          false,
          {
            purpose: 'STAFF_POS',
            staffDeviceContext: device,
            staffAuthenticatedAt: now,
            staffAbsoluteDeadline: deadline,
            expiresAt: deadline,
            ipAddress: null,
            userAgent: null,
          },
          true,
        ),
      find: async (token) =>
        (await (await auth.$context).internalAdapter.findSession(token))?.session ?? null,
      findById: async (id) =>
        sessionFromRecord(
          await (
            await auth.$context
          ).adapter.findOne({ model: 'session', where: [{ field: 'id', value: id }] }),
        ),
      remove: async (token) => {
        await (await auth.$context).internalAdapter.deleteSession(token);
      },
    },
  });
}

async function normalPurpose(
  staff: StaffSessions,
  headers: Headers,
  log: AuthOptions['onLog'],
): Promise<boolean> {
  try {
    return await staff.normalPurpose(headers);
  } catch (error) {
    log(toLogEntry('error', 'INTERNAL_SERVER_ERROR', [error]));
    throw error;
  }
}

function personalSessions(
  options: AuthOptions,
  auth: ReturnType<typeof buildBetterAuth>,
): PersonalSessions {
  return createPersonalSessions({
    database: createStaffOtpDatabase({
      url: options.databaseUrl,
      phoneLockKey: options.staffPhoneLockKey,
    }),
    secret: options.secret,
    now: () => options.clock?.now() ?? new Date(),
    primitive: {
      create: async (userId, workspace, now, deadline) =>
        (await auth.$context).internalAdapter.createSession(
          userId,
          false,
          {
            purpose: 'STAFF_PERSONAL',
            staffPersonalContext: workspace,
            staffAuthenticatedAt: now,
            staffAbsoluteDeadline: deadline,
            expiresAt: deadline,
            ipAddress: null,
            userAgent: null,
          },
          true,
        ),
      find: async (token) =>
        (await (await auth.$context).internalAdapter.findSession(token))?.session ?? null,
      remove: async (token) => {
        await (await auth.$context).internalAdapter.deleteSession(token);
      },
    },
  });
}

function configuredPasskeys(
  options: AuthOptions,
  auth: ReturnType<typeof buildBetterAuth>,
  database: ReturnType<typeof createAuthDatabase>,
) {
  return createPasskeyFacade({
    auth,
    database,
    ids: options.ids,
    policy: passkeyPolicy(options.baseURL, options.trustedOrigins),
    now: () => options.clock?.now() ?? new Date(),
    bindings: options.passkeyBindings,
  });
}
