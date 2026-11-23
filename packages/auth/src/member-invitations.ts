import { createHmac, randomBytes } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';

import type { AuthDatabase } from '@pospay/db';

/**
 * الدومين المحجوز لإيميلات حسابات الموظفين (F1). أي إيميل تحته مش قابل للدعوة، لأن حساب
 * الموظفة مالوش كلمة مرور ولا دخول لإدارة.
 */
export const STAFF_SYNTHETIC_EMAIL_DOMAIN = 'staff.pospay.invalid';

/** عمر رابط تعيين كلمة المرور الافتراضي (ساعة) — زي ما كان قبل الدعوات (D9). */
export const PASSWORD_SET_LINK_TTL_MS = 60 * 60 * 1000;

/** عمر رابط الدعوة (48 ساعة) — IM-Q3؛ الروابط القديمة (ساعة) ما بتتغيرش. */
export const MEMBER_INVITATION_LINK_TTL_MS = 48 * 60 * 60 * 1000;

/** ملخص حساب عضو: اللي الـ API محتاج يعرفه من جداول الهوية. */
export interface MemberAccountSummary {
  readonly userId: string;
  readonly hasPassword: boolean;
}

/** نتيجة إنشاء حساب المدعوّ: هل الحساب ده اتعمل من الدعوة دي ولا كان موجود. */
export interface InvitedMemberOutcome {
  readonly userId: string;
  /** true لما الحساب اتعمل بهذه الدعوة (companyId + operationId)؛ false لما كان حساب موجود قبلها. */
  readonly createdByInvitation: boolean;
}

/** علامة الدعوة على اليوزر: الشركة اللي تقدر تصدر رابط، وهل كلمة المرور اتحطت. */
export interface MemberInvitationMarker {
  readonly invitedByCompanyId: string | null;
  readonly hasPassword: boolean;
}

/** خيارات رابط تعيين كلمة المرور: العمر والساعة، وهل تمسح الروابط القديمة. */
export interface SetPasswordLinkOptions {
  readonly lifetimeMs?: number;
  readonly now?: Date;
  /** true يمسح كل صفوف reset-password القديمة لليوزر قبل ما يكتب الجديد. */
  readonly invalidatePrevious?: boolean;
}

/** الدعوة مرفوضة: اليوزر مش مدعو من الشركة دي، أو كلمة مروره اتحطت خلاص. */
export class InvitationLinkRefusedError extends Error {
  override readonly name = 'InvitationLinkRefusedError';
}

/** حدود جداول الهوية اللي الـ API بيستخدمها في الدعوة — كل الحاجات من pospay_auth. */
export interface MemberInvitationAccounts {
  /** بصمة الإيميل (HMAC) — الإيميل نفسه عمره ما بيتخزن ولا بيتبعت في log. */
  hashEmail(email: string): string;
  /** يقرأ حساب بالإيميل؛ null لو مفيش. */
  findByEmail(email: string): Promise<MemberAccountSummary | null>;
  /** يقرأ اليوزر اللي اتعمل من عملية دعوة معيّنة في الشركة دي؛ null لو مفيش. */
  findByInvitation(
    operationId: string,
    companyId: string,
  ): Promise<MemberAccountSummary | null>;
  /** ينشئ حساب المدعوّ بحساب دخول (من غير كلمة مرور) وعلامته، أو بيرجّع الحساب الموجود. */
  createInvitedMember(input: {
    operationId: string;
    companyId: string;
    email: string;
    name: string;
  }): Promise<InvitedMemberOutcome>;
  /** يقرأ علامة الدعوة على اليوزر. */
  readMarker(userId: string): Promise<MemberInvitationMarker | null>;
  /** يصدر رابط تعيين كلمة مرور — بس لليوزر اللي دعته الشركة دي واللي مالوش كلمة مرور. */
  issueInvitationLink(input: {
    userId: string;
    companyId: string;
    redirectTo: string;
    lifetimeMs?: number;
    now?: Date;
  }): Promise<string>;
}

/** هل الإيميل تحت الدومين المحجوز لحسابات الموظفين (F1). */
export function isStaffSyntheticEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  return at > 0 && email.slice(at + 1).trim().toLowerCase() === STAFF_SYNTHETIC_EMAIL_DOMAIN;
}

const normalized = (email: string): string => email.trim().toLowerCase();

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === '23505';

/**
 * يبني رابط تعيين كلمة المرور: بيكتب صف verification بنفس الشكل اللي Better Auth بيستهلكه في
 * POST /reset-password، وبيطير الروابط القديمة لليوزر لو اتطلب.
 *
 * @param database  قاعدة الهوية على pospay_auth
 * @param ids       مولّد الـ UUID v7
 * @param baseUrl   عنوان الـ auth handler
 * @param userId    اليوزر
 * @param redirectTo صفحة الـ set-password
 * @param options   العمر والساعة، وهل تمسح الروابط القديمة
 * @returns الرابط — فيه token، فبيتسلم للطلب ولا يتكتبش في log
 */
export async function issueSetPasswordLink(
  database: AuthDatabase,
  ids: { newId(): string },
  baseUrl: string,
  userId: string,
  redirectTo: string,
  options: SetPasswordLinkOptions = {},
): Promise<string> {
  const lifetime = options.lifetimeMs ?? PASSWORD_SET_LINK_TTL_MS;
  const now = options.now ?? new Date();
  const token = randomBytes(24).toString('base64url');
  const { verification } = database.schema;
  await database.db.transaction(async (tx) => {
    if (options.invalidatePrevious === true) {
      await tx
        .delete(verification)
        .where(and(eq(verification.value, userId), like(verification.identifier, 'reset-password:%')));
    }
    await tx.insert(verification).values({
      id: ids.newId(),
      identifier: `reset-password:${token}`,
      value: userId,
      expiresAt: new Date(now.getTime() + lifetime),
      createdAt: now,
      updatedAt: now,
    });
  });
  return `${baseUrl}/reset-password/${token}?callbackURL=${encodeURIComponent(redirectTo)}`;
}

/**
 * بيبني حدود جداول الهوية لعملية الدعوة: البصمة، والبحث بالإيميل، والإنشاء، وعلامة الدعوة.
 *
 * @param options  قاعدة الهوية ومولّد الـ ids وسر البصمة وعنوان الـ auth
 * @returns حدود الدعوة
 */
export function createMemberInvitationAccounts(options: {
  database: AuthDatabase;
  ids: { newId(): string };
  secret: string;
  baseUrl: string;
}): MemberInvitationAccounts {
  const { database, ids, secret, baseUrl } = options;
  const { user, account } = database.schema;

  const hashEmail = (email: string): string =>
    createHmac('sha256', secret)
      .update('pospay:member-invitation:email:v1\0')
      .update(normalized(email))
      .digest('base64url');

  const readByEmail = async (email: string): Promise<MemberAccountSummary | null> => {
    const rows = await database.db
      .select({ id: user.id, hasPassword: account.password })
      .from(user)
      .leftJoin(
        account,
        and(eq(account.userId, user.id), eq(account.providerId, 'credential')),
      )
      .where(eq(user.email, normalized(email)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return { userId: row.id, hasPassword: row.hasPassword !== null };
  };

  const readMarker = async (userId: string): Promise<MemberInvitationMarker | null> => {
    const rows = await database.db
      .select({
        invitedByCompanyId: user.invitedByCompanyId,
        hasPassword: account.password,
      })
      .from(user)
      .leftJoin(
        account,
        and(eq(account.userId, user.id), eq(account.providerId, 'credential')),
      )
      .where(eq(user.id, userId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      invitedByCompanyId: row.invitedByCompanyId,
      hasPassword: row.hasPassword !== null,
    };
  };

  const readByOperation = async (
    operationId: string,
    companyId: string,
  ): Promise<MemberAccountSummary | null> => {
    const rows = await database.db
      .select({ id: user.id, hasPassword: account.password })
      .from(user)
      .leftJoin(
        account,
        and(eq(account.userId, user.id), eq(account.providerId, 'credential')),
      )
      .where(
        and(
          eq(user.invitationOperationId, operationId),
          eq(user.invitedByCompanyId, companyId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return { userId: row.id, hasPassword: row.hasPassword !== null };
  };

  const createInvitedMember = async (input: {
    operationId: string;
    companyId: string;
    email: string;
    name: string;
  }): Promise<InvitedMemberOutcome> => {
    const email = normalized(input.email);
    const byOperation = await database.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.invitationOperationId, input.operationId))
      .limit(1);
    const existingByOperation = byOperation[0];
    if (existingByOperation !== undefined) {
      return { userId: existingByOperation.id, createdByInvitation: true };
    }
    const existing = await readByEmail(email);
    if (existing !== null) return { userId: existing.userId, createdByInvitation: false };
    const userId = ids.newId();
    const now = new Date();
    try {
      await database.db.transaction(async (tx) => {
        await tx.insert(user).values({
          id: userId,
          name: input.name,
          email,
          emailVerified: false,
          invitedByCompanyId: input.companyId,
          invitationOperationId: input.operationId,
          createdAt: now,
          updatedAt: now,
        });
        // حساب دخول من غير كلمة مرور: اليوزر ما يقدرش يدخل غير لما يحط كلمة مروره من الرابط.
        await tx.insert(account).values({
          id: ids.newId(),
          accountId: userId,
          providerId: 'credential',
          userId,
          createdAt: now,
          updatedAt: now,
        });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await readByEmail(email);
      if (raced === null) throw error;
      return { userId: raced.userId, createdByInvitation: false };
    }
    return { userId, createdByInvitation: true };
  };

  const issueInvitationLink = async (input: {
    userId: string;
    companyId: string;
    redirectTo: string;
    lifetimeMs?: number;
    now?: Date;
  }): Promise<string> => {
    const marker = await readMarker(input.userId);
    if (marker === null) throw new InvitationLinkRefusedError();
    if (marker.invitedByCompanyId !== input.companyId) throw new InvitationLinkRefusedError();
    if (marker.hasPassword) throw new InvitationLinkRefusedError();
    return issueSetPasswordLink(database, ids, baseUrl, input.userId, input.redirectTo, {
      ...(input.lifetimeMs === undefined ? {} : { lifetimeMs: input.lifetimeMs }),
      ...(input.now === undefined ? {} : { now: input.now }),
      invalidatePrevious: true,
    });
  };

  return {
    hashEmail,
    findByEmail: readByEmail,
    findByInvitation: readByOperation,
    createInvitedMember,
    readMarker,
    issueInvitationLink,
  };
}
