import { randomBytes } from 'node:crypto';
import type { createAuthDatabase } from '@pospay/db';
import type { AuthOptions, AuthService, buildBetterAuth } from './config.ts';
import type { SessionCookieNames } from './session-cookie.ts';
import type { StaffUserAccess } from './staff-access-users.ts';
import { STAFF_SYNTHETIC_EMAIL_DOMAIN } from './staff-access-users.ts';
import { configuredPrivateView } from './private-view.ts';
import { isPasskeyRoute } from './passkey-policy.ts';
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
  auth: ReturnType<typeof buildBetterAuth>,
  cookieNames: SessionCookieNames,
): AuthService {
  const staff = staffSessions(options, auth, database, cookieNames);
  const personal = personalSessions(options, auth, database);
  const passkeys = configuredPasskeys(options, auth, database);
  return {
    staff,
    personal,
    passkeys,
    staffUsers,
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
    issuePasswordSetLink: async (userId, redirectTo) => {
      // حساب الموظفة بلا كلمة سر أبداً (D8): الرابط لا يُصدر له حتى لو حصل token من مسار آخر.
      if (await staffUsers.isStaffUser(userId)) throw new Error('STAFF_USER_CREDENTIAL_REFUSED');
      return issueSetPasswordLink(await auth.$context, userId, redirectTo);
    },
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
    let payload: { token?: unknown } = {};
    try {
      payload = JSON.parse(new TextDecoder().decode(raw)) as { token?: unknown };
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (typeof payload.token === 'string') {
      const linked = await staffUsers.userIdForResetToken(payload.token);
      const staffUserId = linked !== null && (await staffUsers.isStaffUser(linked)) ? linked : null;
      if (staffUserId !== null)
        return Response.json(
          { code: 'STAFF_USER_CREDENTIAL_REFUSED', message: 'reset refused' },
          { status: 400 },
        );
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
