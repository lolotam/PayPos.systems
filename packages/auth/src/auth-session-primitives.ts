import { createStaffOtpDatabase, type createAuthDatabase } from '@pospay/db';
import type { AuthOptions, AuthLogEntry, buildBetterAuth } from './config.ts';
import type { SessionCookieNames } from './session-cookie.ts';
import { createStaffSessions, type StaffSessions } from './staff-sessions.ts';
import { createPersonalSessions, type PersonalSessions } from './personal-sessions.ts';
import { sessionFromRecord } from './staff-session-fence.ts';
import { createPasskeyFacade } from './passkeys.ts';
import { passkeyPolicy } from './passkey-policy.ts';

// Better Auth's messages are a fixed phrase, then ": " and a value (a URL, an origin, an id). Only the phrase
// survives, and only when it is plain words: no digit, no URL character, no word long enough to be a token.
const PHRASE = /^[A-Za-z][A-Za-z '()_-]{0,99}$/;
const LONG_WORD = /[A-Za-z_]{16,}/g;

export function toLogEntry(
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

export function staffSessions(
  options: AuthOptions,
  auth: ReturnType<typeof buildBetterAuth>,
  authDatabase: ReturnType<typeof createAuthDatabase>,
  cookieNames: SessionCookieNames,
): StaffSessions {
  return createStaffSessions({
    database: createStaffOtpDatabase({
      url: options.databaseUrl,
      phoneLockKey: options.staffPhoneLockKey,
    }),
    authDatabase,
    secret: options.secret,
    normalCookie: cookieNames.normal,
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

export async function normalPurpose(
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

export function personalSessions(
  options: AuthOptions,
  auth: ReturnType<typeof buildBetterAuth>,
  authDatabase: ReturnType<typeof createAuthDatabase>,
): PersonalSessions {
  return createPersonalSessions({
    database: createStaffOtpDatabase({
      url: options.databaseUrl,
      phoneLockKey: options.staffPhoneLockKey,
    }),
    authDatabase,
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

export function configuredPasskeys(
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
