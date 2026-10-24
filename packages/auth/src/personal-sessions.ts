import { makeSignature } from 'better-auth/crypto';
import type { AuthDatabase, StaffOtpDatabase } from '@pospay/db';
import { deleteStaffSessionRow } from './staff-session-fence.ts';
import { verifiedToken, type SessionRow } from './staff-sessions.ts';
import { staffDeadline } from './staff-otp/policy.ts';
import type { PersonalSession, PersonalWorkspace } from './staff-otp/types.ts';
import { hasCookie, type SignOutOutcome } from './session-sign-out.ts';

export const PERSONAL_COOKIE = 'pospay-personal.session_token';

interface PersonalOptions {
  database: StaffOtpDatabase;
  authDatabase: AuthDatabase;
  secret: string;
  now(): Date;
  primitive: {
    create(
      userId: string,
      workspace: PersonalWorkspace,
      now: Date,
      deadline: Date,
    ): Promise<SessionRow | null>;
    find(token: string): Promise<SessionRow | null>;
    remove(token: string): Promise<void>;
  };
}

/** الهاتف الشخصي له cookie وغاية مستقلان ولا يجدد موعد الجلسة. */
export function createPersonalSessions(options: PersonalOptions) {
  const resolve = async (headers: Headers) => {
    const token = await verifiedToken(headers, PERSONAL_COOKIE, options.secret);
    const row = token === null ? null : await options.primitive.find(token);
    const session = row === null ? null : personalRow(row, options.now());
    return session !== null &&
      (await options.database.bindingValid(session.userId, session.authenticatedAt))
      ? session
      : null;
  };
  return {
    issue: (userId: string, workspace: PersonalWorkspace, validate: () => Promise<boolean>) =>
      issue(options, userId, workspace, validate),
    resolve,
    /** ينهي جلسة الـ cookie الموقّعة بس؛ امتلاكها هو السلطة، فالأهلية وربط التليفون ما بيتستشاروش. */
    signOut: (headers: Headers) => signOutPersonalSession(options, headers),
    close: () => options.database.close(),
  };
}

async function signOutPersonalSession(
  options: PersonalOptions,
  headers: Headers,
): Promise<SignOutOutcome> {
  const token = await verifiedToken(headers, PERSONAL_COOKIE, options.secret);
  const row = token === null ? null : await options.primitive.find(token);
  const clearing = hasCookie(headers, PERSONAL_COOKIE) ? cookie('', new Date(0)) : null;
  if (row === null || row.purpose !== 'STAFF_PERSONAL') return { cookie: clearing, ended: false };
  const deleted = await deleteStaffSessionRow(options.authDatabase, row.id, 'STAFF_PERSONAL');
  if (!deleted || personalRow(row, options.now()) === null)
    return { cookie: clearing, ended: false };
  return { cookie: clearing, ended: true, userId: row.userId };
}

export type PersonalSessions = ReturnType<typeof createPersonalSessions>;

const cookie = (value: string, deadline: Date) =>
  `${PERSONAL_COOKIE}=${value}; Path=/v1; HttpOnly; Secure; SameSite=Lax; Expires=${deadline.toUTCString()}`;

async function issue(
  options: PersonalOptions,
  userId: string,
  workspace: PersonalWorkspace,
  validate: () => Promise<boolean>,
) {
  const now = options.now();
  // قرار المالك 2026-10-04: نفس نهاية جلسة الكشك المطلقة، بلا خمول أو تجديد.
  const deadline = staffDeadline(now);
  let made: SessionRow | null = null;
  try {
    return await options.database.rotatePersonal(userId, async () => {
      made = await options.primitive.create(userId, workspace, now, deadline);
      const session = made === null ? null : personalRow(made, options.now());
      if (made === null || session === null || !(await validate()))
        throw new Error('PERSONAL_SESSION_REFUSED');
      const signature = await makeSignature(made.token, options.secret);
      return {
        id: made.id,
        session,
        cookie: cookie(encodeURIComponent(`${made.token}.${signature}`), deadline),
      };
    });
  } catch (cause) {
    const uncertain = made as SessionRow | null;
    if (uncertain !== null) await options.primitive.remove(uncertain.token);
    throw new Error('PERSONAL_SESSION_REFUSED', { cause });
  }
}

function personalRow(row: SessionRow, now: Date): PersonalSession | null {
  const context = row.staffPersonalContext as Partial<PersonalWorkspace> | null | undefined;
  if (
    row.purpose !== 'STAFF_PERSONAL' ||
    context?.purpose !== 'STAFF_PERSONAL' ||
    typeof context.companyId !== 'string' ||
    typeof context.businessId !== 'string' ||
    row.staffAuthenticatedAt == null ||
    row.staffAbsoluteDeadline == null ||
    now >= row.staffAbsoluteDeadline ||
    row.expiresAt.getTime() !== row.staffAbsoluteDeadline.getTime()
  )
    return null;
  return {
    userId: row.userId,
    sessionId: row.id,
    context: context as PersonalWorkspace,
    authenticatedAt: row.staffAuthenticatedAt,
    deadline: row.staffAbsoluteDeadline,
  };
}
