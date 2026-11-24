import { assembleAuthService } from './auth-service.ts';
import { toLogEntry } from './auth-session-primitives.ts';
import { staffCredentialAdapter } from './staff-credential-adapter.ts';

import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { createAuthDatabase } from '@pospay/db';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import { type PersonalSessions } from './personal-sessions.ts';
import { type PrivateViewFacade } from './private-view.ts';
import { sessionCookieNames, type SessionCookieNames } from './session-cookie.ts';
import { passkeyPolicy, registrationPlugin } from './passkey-policy.ts';
import { type ActivePasskeyBindings, type PasskeyFacade } from './passkeys.ts';
import { type StaffSessions } from './staff-sessions.ts';
import {
  createStaffUserAccess,
  staffUserD8Hooks,
  type StaffUserAccess,
} from './staff-access-users.ts';

/**
 * ما يحتاجه Better Auth: الـ pool على pospay_auth، السر، العنوان، الـ origins المسموحة، ومولّد الـ ids.
 */
export interface AuthOptions {
  readonly staffPhoneLockKey: (hash: Uint8Array) => bigint;
  readonly clock?: { now(): Date };
  readonly entropy?: { bytes(n: number): Uint8Array } | undefined;
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
  /** بادئة اسم cookies الجلسة — كل بيئة ببادئة، عشان cookie الإنتاج ما يتقراش في staging (ADR-0001 §3). */
  readonly cookiePrefix?: string | undefined;
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
  readonly privateView: PrivateViewFacade;
  /** حساب الموظفة: الإنشاء والإيجاد والإلغاء بمعرّف العملية — ومفيهوش أي مسار credential (spec 076 F1). */
  readonly staffUsers: StaffUserAccess;
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
  // قبل أي pool: بادئة cookie غلط معناها اسم cookie مش متوقع، والتطبيق لازم يقف بدل ما يخدم.
  const cookieNames = sessionCookieNames(options);
  const database = createAuthDatabase({ url: options.databaseUrl });
  const staffUsers = createStaffUserAccess({
    databaseUrl: options.databaseUrl,
    phoneLockKey: options.staffPhoneLockKey,
    marker: database,
  });
  try {
    await database.ping();
  } catch (error) {
    await database.close();
    await staffUsers.close();
    throw error;
  }
  const auth = buildBetterAuth(options, database, staffUsers, cookieNames);
  const service = assembleAuthService(options, database, staffUsers, auth, cookieNames);
  return service;
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
  staffUsers: StaffUserAccess,
  cookieNames: SessionCookieNames,
): ReturnType<typeof betterAuth<StaffAuthConfiguration>> {
  return betterAuth<StaffAuthConfiguration>({
    appName: 'PosPay',
    baseURL: options.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: options.secret,
    trustedOrigins: [...options.trustedOrigins],
    database: staffCredentialAdapter(
      drizzleAdapter(database.db, { provider: 'pg', schema: database.schema }),
      staffUsers,
    ),
    // Sign-up is closed (ADR-0003 §6): users are provisioned server-side by the operator script.
    emailAndPassword: { enabled: true, disableSignUp: true },
    session: { additionalFields: STAFF_SESSION_FIELDS },
    plugins: [
      twoFactor({ issuer: 'PosPay' }),
      registrationPlugin(passkeyPolicy(options.baseURL, options.trustedOrigins)),
    ],
    databaseHooks: staffUserD8Hooks(staffUsers),
    advanced: {
      cookiePrefix: cookieNames.prefix,
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
