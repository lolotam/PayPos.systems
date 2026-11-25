import { and, eq, inArray, isNotNull, like } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { IdentitySchema } from './auth-database.ts';
import { account, user, verification } from '../schema/identity-auth.ts';
import { RESET_LINK_PREFIX } from './password-reset-database.ts';

/** مستخدم الهوية بالإيميل مع علامة الدعوة اللي عليه: الشركة والعملية اللي أنشأته، لو اتنشأ بدعوة. */
export interface IdentityEmailOwner {
  readonly id: string;
  readonly invitedByCompanyId: string | null;
  readonly invitationOperationId: string | null;
}

/** مدخلات إنشاء حساب المدعوّ — كل القيم بتيجي من السيرفر، مفيش منها إيميل موظفة ولا توكن. */
export interface InvitedMemberRow {
  readonly id: string;
  /** معرّف صف حساب الدخول (credential) اللي بيتكتب مع اليوزر في نفس المعاملة. */
  readonly accountId: string;
  readonly email: string;
  readonly name: string;
  readonly invitedByCompanyId: string;
  readonly invitationOperationId: string;
  readonly now: Date;
}

/** مدخلات إصدار رابط الدعوة: صف verification بنفس الشكل اللي Better Auth بيستهلكه. */
export interface InvitationLinkRow {
  readonly id: string;
  readonly identifier: string;
  readonly companyId: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly now: Date;
}

/** القراءات والكتابات على جداول الهوية اللي دعوة الأعضاء محتاجاها — كلها على pospay_auth. */
export interface MemberInvitationQueries {
  /** بيقرأ مستخدم بالإيميل المنسّض؛ null لما مفيش مستخدم بالإيميل ده. */
  findMemberByEmail(email: string): Promise<IdentityEmailOwner | null>;
  /** بيقرأ المستخدم اللي اتنشأ من عملية دعوة في شركة معيّنة؛ null لما العملية ما خلتش أثر. */
  findMemberByInvitation(operationId: string, companyId: string): Promise<{ id: string } | null>;
  /** هل لحساب دخول المستخدم كلمة مرور؛ null لما مفيش مستخدم بالمعرّف ده. */
  readHasPassword(userId: string): Promise<boolean | null>;
  /**
   * المعرفات اللي ليها حساب دخول بكلمة مرور، في قراءة واحدة: قائمة الدعوات كانت بتقرأ حالة كلمة
   * المرور لكل صف على حدة (N+1 على جداول الهوية). القائمة الفاضية بترجّع set فاضية من غير استعلام.
   *
   * @param userIds معرّفات المستخدمين المراد فحصهم (التكرار بيتشال)
   * @returns المعرفات اللي كلمة مرورها موجودة
   */
  readHasPasswords(userIds: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * بينشئ المدعوّ وحساب دخول من غير كلمة مرور في معاملة واحدة. إيميل موجود بيرجّع
   * conflict من غير استثناء، فالمتصل بيعيد القراءة ويحكم.
   */
  createInvitedMember(input: InvitedMemberRow): Promise<'created' | 'conflict'>;
  /**
   * بيصدر رابط الدعوة في معاملة واحدة تحت قفل صف المستخدم وصف حساب الدخول: بيرفض لو
   * المستخدم مش مدعوّ من الشركة دي أو كلمة مروره اتحطت، وبيبطل الروابط القديمة قبل الكتابة.
   *
   * @returns true لما الرابط اتكتب، وfalse لما الإصدار مرفوض
   */
  issueInvitationLink(input: InvitationLinkRow): Promise<boolean>;
  /**
   * بيمسح حساب اتنشأ من عملية دعوة معيّنة لشركة معيّنة، بس لو لسه من غير كلمة مرور: بيقفل صف
   * اليوزر وحسابه، ويمسح الروابط الحية، ويمسح اليوزر. بيتكرر بأمان: لو اليوزر اتمسح قبل كده يرجّع
   * discarded. العضوية مش مرئية هنا — المتصل هو اللي أثبت (بإلغاء صف الدعوة تحت قفله) إن مفيش عضوية.
   *
   * @returns discarded لما الحساب اتمسح أو مكانش موجود، وkept لما له كلمة مرور فاتسابت
   */
  discardInvitedMember(operationId: string, companyId: string): Promise<'discarded' | 'kept'>;
}

type Database = PostgresJsDatabase<IdentitySchema>;

const findMemberByEmail = async (
  db: Database,
  email: string,
): Promise<IdentityEmailOwner | null> => {
  const [row] = await db
    .select({
      id: user.id,
      invitedByCompanyId: user.invitedByCompanyId,
      invitationOperationId: user.invitationOperationId,
    })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return row ?? null;
};

const findMemberByInvitation = async (
  db: Database,
  operationId: string,
  companyId: string,
): Promise<{ id: string } | null> => {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.invitationOperationId, operationId), eq(user.invitedByCompanyId, companyId)))
    .limit(1);
  return row ?? null;
};

const readHasPassword = async (db: Database, userId: string): Promise<boolean | null> => {
  const rows = await db
    .select({ password: account.password })
    .from(user)
    .leftJoin(account, and(eq(account.userId, user.id), eq(account.providerId, 'credential')))
    .where(eq(user.id, userId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : row.password !== null;
};

const readHasPasswords = async (
  db: Database,
  userIds: readonly string[],
): Promise<ReadonlySet<string>> => {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Set();
  const rows = await db
    .select({ userId: account.userId })
    .from(account)
    .where(
      and(
        inArray(account.userId, unique),
        eq(account.providerId, 'credential'),
        isNotNull(account.password),
      ),
    );
  return new Set(rows.map((row) => row.userId));
};

const createInvitedMember = async (
  db: Database,
  input: InvitedMemberRow,
): Promise<'created' | 'conflict'> =>
  db.transaction(async (tx) => {
    // الهدف الوحيد للتعارض هو الإيميل: العملية نفسها بتتكرر بنفس الإيميل، فتعارضها بيظهر هنا.
    const rows = await tx
      .insert(user)
      .values({
        id: input.id,
        name: input.name,
        email: input.email,
        emailVerified: false,
        invitedByCompanyId: input.invitedByCompanyId,
        invitationOperationId: input.invitationOperationId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing({ target: user.email })
      .returning({ id: user.id });
    if (rows.length === 0) return 'conflict';
    // حساب دخول من غير كلمة مرور: اليوزر ما يدخلش غير لما يحط كلمة مروره من الرابط.
    await tx.insert(account).values({
      id: input.accountId,
      accountId: input.id,
      providerId: 'credential',
      userId: input.id,
      createdAt: input.now,
      updatedAt: input.now,
    });
    return 'created';
  });

const issueInvitationLink = async (db: Database, input: InvitationLinkRow): Promise<boolean> =>
  db.transaction(async (tx) => {
    // القفل على صف المستخدم وصف حساب الدخول معاً: تعيين كلمة المرور في Better Auth بيحدّث صف
    // الحساب، فبيستنى هنا. استهلاك الرابط (password-reset-database) بياخد نفس القفلين بنفس الترتيب
    // وبيمسح الروابط في معاملته — فمفيش رابط حي على حساب له كلمة مرور. القفلين منفصلين لأن FOR UPDATE ما يتطبقش على الجهة الاختيارية في outer join.
    const [owner] = await tx
      .select({ invitedByCompanyId: user.invitedByCompanyId })
      .from(user)
      .where(eq(user.id, input.userId))
      .for('update');
    if (owner === undefined || owner.invitedByCompanyId !== input.companyId) return false;
    const [login] = await tx
      .select({ password: account.password })
      .from(account)
      .where(and(eq(account.userId, input.userId), eq(account.providerId, 'credential')))
      .for('update');
    if (login === undefined || login.password !== null) return false;
    await tx
      .delete(verification)
      .where(
        and(
          eq(verification.value, input.userId),
          like(verification.identifier, `${RESET_LINK_PREFIX}%`),
        ),
      );
    await tx.insert(verification).values({
      id: input.id,
      identifier: input.identifier,
      value: input.userId,
      expiresAt: input.expiresAt,
      createdAt: input.now,
      updatedAt: input.now,
    });
    return true;
  });

const discardInvitedMember = async (
  db: Database,
  operationId: string,
  companyId: string,
): Promise<'discarded' | 'kept'> =>
  db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: user.id })
      .from(user)
      .where(
        and(eq(user.invitationOperationId, operationId), eq(user.invitedByCompanyId, companyId)),
      )
      .for('update');
    if (owner === undefined) return 'discarded';
    const [login] = await tx
      .select({ password: account.password })
      .from(account)
      .where(and(eq(account.userId, owner.id), eq(account.providerId, 'credential')))
      .for('update');
    if (login !== undefined && login.password !== null) return 'kept';
    await tx
      .delete(verification)
      .where(
        and(
          eq(verification.value, owner.id),
          like(verification.identifier, `${RESET_LINK_PREFIX}%`),
        ),
      );
    await tx.delete(user).where(eq(user.id, owner.id));
    return 'discarded';
  });

/**
 * حدود جداول الهوية لدعوة الأعضاء (G1): الإيميل بيتخزن صريح في جدول اليوزر زي أي حساب، وصف
 * الدعوة في الشركة بيحمل بصمته بس — فمفيش إيميل ولا توكن بيخرج من الجدول ده للـ tenant.
 *
 * @param db اتصال الهوية على pospay_auth
 * @returns القراءات والكتابات
 */
export function memberInvitationQueries(db: Database): MemberInvitationQueries {
  return {
    findMemberByEmail: (email) => findMemberByEmail(db, email),
    findMemberByInvitation: (operationId, companyId) =>
      findMemberByInvitation(db, operationId, companyId),
    readHasPassword: (userId) => readHasPassword(db, userId),
    readHasPasswords: (userIds) => readHasPasswords(db, userIds),
    createInvitedMember: (input) => createInvitedMember(db, input),
    issueInvitationLink: (input) => issueInvitationLink(db, input),
    discardInvitedMember: (operationId, companyId) =>
      discardInvitedMember(db, operationId, companyId),
  };
}
