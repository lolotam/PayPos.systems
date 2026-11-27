import { randomBytes } from 'node:crypto';
import type { createAuthDatabase } from '@pospay/db';
import type { AuthOptions, AuthService, buildBetterAuth } from './config.ts';
import type { SessionCookieNames } from './session-cookie.ts';
import type { MemberInvitationAccounts } from './member-invitations.ts';
import type { StaffUserAccess } from './staff-access-users.ts';
import { STAFF_SYNTHETIC_EMAIL_DOMAIN } from './staff-access-users.ts';
import { configuredPrivateView } from './private-view.ts';
import { createMyPreferences } from './my-preferences.ts';
import { isPasskeyRoute } from './passkey-policy.ts';
import { identifierOf } from './password-reset.ts';
import type { StaffSessions } from './staff-sessions.ts';
import {
  staffSessions,
  personalSessions,
  configuredPasskeys,
  normalPurpose,
} from './auth-session-primitives.ts';
const SET_PASSWORD_LINK_TTL_MS = 60 * 60 * 1000;

/** بيجمع واجهة الـ auth فوق Better Auth والواجهات الجاهزة — تجميع ميكانيكي بلا قرارات. */
export function assembleAuthService(
  options: AuthOptions,
  database: ReturnType<typeof createAuthDatabase>,
  staffUsers: StaffUserAccess,
  members: MemberInvitationAccounts,
  auth: ReturnType<typeof buildBetterAuth>,
  cookieNames: SessionCookieNames,
): AuthService {
  const staff = staffSessions(options, auth, database, cookieNames);
  const personal = personalSessions(options, auth, database);
  const passkeys = configuredPasskeys(options, auth, database);
  return {
    preferences: createMyPreferences(database),
    staff,
    personal,
    passkeys,
    staffUsers,
    members,
    privateView: configuredPrivateView(options, database),
    handler: (request) => authHandler(request, auth, staff, staffUsers, options.onLog),
    getSession: async (headers) => {
      if (!(await normalPurpose(staff, headers, options.onLog))) return null;
      const { headers: out, response } = await auth.api.getSession({
        headers,
        returnHeaders: true,
      });
      if (response === null) return null;
      // D8 عند الاستهلاك (P1-6): جلسة عادية لمستخدم موظفة تُعامَل كلا جلسة — حتى لو وصلت بوسيلة أخرى.
      if (await staffUsers.isStaffUser(response.user.id)) return null;
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
    hashPassword: async (password) => (await auth.$context).password.hash(password),
    issuePasswordSetLink: async (userId, redirectTo) =>
      issueSetPasswordLink({
        options,
        database,
        auth,
        userId,
        redirectTo,
      }),
    discardUser: async (userId) => {
      await (await auth.$context).internalAdapter.deleteUser(userId);
    },
    recordPlatformAction: (entry) =>
      database.recordPlatformAction({ id: options.ids.newId(), ...entry }),
    ping: () => database.ping(),
    close: async () => {
      await Promise.all([database.close(), staffUsers.close(), staff.close(), personal.close()]);
    },
  };
}

/** بوابات D8 على استهلاك reset-password: رفض حساب الموظفة قبل تسليم الطلب لـ Better Auth (P1-6). */
async function authHandler(
  request: Request,
  auth: ReturnType<typeof buildBetterAuth>,
  staff: StaffSessions,
  staffUsers: StaffUserAccess,
  onLog: AuthOptions['onLog'],
): Promise<Response> {
  if (isPasskeyRoute(request.url) || !(await normalPurpose(staff, request.headers, onLog)))
    return new Response(null, { status: 403 });
  const current = await auth.api.getSession({
    headers: request.headers,
    query: { disableRefresh: true },
  });
  if (current !== null && (await staffUsers.isStaffUser(current.user.id)))
    return Response.json({ code: 'STAFF_USER_SESSION_REFUSED' }, { status: 403 });
  if (request.method === 'POST' && new URL(request.url).pathname === '/v1/auth/reset-password') {
    // الجسم يُقرأ مرة واحدة ويُعاد بناؤه للطلب المُمرَّر — البوابة تسبق Better Auth ولا تلغم المسار.
    const raw = await request.arrayBuffer();
    let payload: unknown = null;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    // الجسم قد يكون null أو مصفوفة أو نصاً: لا نقرأ token إلا من كائن، والباقي يرده Better Auth برفض صحيح.
    const token =
      typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        ? (payload as { token?: unknown }).token
        : undefined;
    if (typeof token === 'string') {
      const linked = await staffUsers.userIdForResetToken(token);
      const staffUserId = linked !== null && (await staffUsers.isStaffUser(linked)) ? linked : null;
      if (staffUserId !== null)
        // AC-ACT-18: نفس رد الرابط الميت بالضبط، فلا يفرّق المهاجم بين حساب موظفة ورابط منتهٍ.
        return Response.json({ code: 'INVALID_TOKEN', message: 'Invalid token' }, { status: 400 });
    }
    const replay = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: raw,
    });
    return auth.handler(replay);
  }
  return auth.handler(request);
}

type AuthContext = Awaited<ReturnType<typeof buildBetterAuth>['$context']>;

/** طلب إصدار رابط تعيين كلمة المرور — الساعة ومولّد الـ ids والعميل كلهم من options. */
interface SetPasswordLinkRequest {
  readonly options: AuthOptions;
  readonly database: ReturnType<typeof createAuthDatabase>;
  readonly auth: ReturnType<typeof buildBetterAuth>;
  readonly userId: string;
  readonly redirectTo: string;
}

async function provision(
  context: AuthContext,
  input: { email: string; name: string; password: string },
): Promise<string> {
  // النطاق المحجوز لحسابات الموظفات فقط (D8): ما حدش يقدر يعمل مستخدم عادي ببريد اصطناعي.
  if (input.email.toLowerCase().endsWith(`@${STAFF_SYNTHETIC_EMAIL_DOMAIN}`))
    throw new RangeError('email domain is reserved for staff users');
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

/**
 * بيصدر رابط تعيين كلمة المرور للـ operator. القرار على "الحساب ده موظفة ولا لأ" بيتاخد جوه معاملة
 * الـ D8 تحت قفل صف اليوزر، فاليوزر اللي بقى موظفة بين الإصدار وما ينفّذش بياكلش رابط.
 *
 * @param request الساعة ومولّد الـ ids والعميل واليوزر وصفحة الرجوع
 * @returns رابط فيه التوكن، صالح لمرة واحدة
 */
async function issueSetPasswordLink(request: SetPasswordLinkRequest): Promise<string> {
  const context = await request.auth.$context;
  const token = randomBytes(24).toString('base64url');
  const now = request.options.clock?.now() ?? new Date();
  const outcome = await request.database.passwordResets.issueOperatorResetLink({
    id: request.options.ids.newId(),
    identifier: identifierOf(token),
    userId: request.userId,
    expiresAt: new Date(now.getTime() + SET_PASSWORD_LINK_TTL_MS),
    now,
  });
  if (outcome === 'staff-user') throw new Error('STAFF_USER_CREDENTIAL_REFUSED');
  if (outcome === 'missing-user') throw new Error('USER_NOT_FOUND');
  return `${context.baseURL}/reset-password/${token}?callbackURL=${encodeURIComponent(request.redirectTo)}`;
}
