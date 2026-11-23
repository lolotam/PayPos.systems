import { and, eq, like, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { IdentitySchema } from './auth-database.ts';
import { account, user, verification } from '../schema/identity-auth.ts';

/** حساب مستخدم الهوية كما تحتاجه دعوة الأعضاء (G1): الـ id وهل له كلمة مرور. */
export interface IdentityMemberAccount {
  readonly id: string;
  readonly hasPassword: boolean;
}

/** علامة الدعوة على مستخدم الهوية: الشركة اللي دعته، وهل كلمة المرور اتحطت. */
export interface IdentityInvitationMarker {
  readonly invitedByCompanyId: string | null;
  readonly hasPassword: boolean;
}

/** نتيجة كتابة المدعوّ: اتعمل، أو الإيميل كان لليوزر فاتح قبل كده. */
export type InvitedMemberInsertion = 'created' | 'email-taken';

/** مدخلات إنشاء حساب المدعوّ — كل القيم بتيجي من السيرفر، مفيش منها إيميل موظفة ولا توكن. */
export interface InvitedMemberRow {
  readonly id: string;
  /** معرّف صف حساب الدخول (credential) اللي بيتقافل مع اليوزر في نفس المعاملة. */
  readonly accountId: string;
  readonly email: string;
  readonly name: string;
  readonly invitedByCompanyId: string;
  readonly invitationOperationId: string;
  readonly now: Date;
}

/** مدخلات صف verification بتاع رابط تعيين كلمة المرور — نفس الشكل اللي Better Auth بيستهلكه. */
export interface VerificationRow {
  readonly id: string;
  readonly identifier: string;
  readonly value: string;
  readonly expiresAt: Date;
  readonly now: Date;
  /** بادئة المعرّف اللي صفوفها القديمة بتتحذف قبل الكتابة (إعادة إصدار بتبطل الروابط الباطلة)؛ غيابها يعني مفيش إبطال. */
  readonly invalidatePrefix?: string;
}

/** القراءات والكتابات على جداول الهوية اللي دعوة الأعضاء محتاجاها — بتشتغل كلها على pospay_auth. */
export interface MemberInvitationQueries {
  /** بيقرأ حساب بالإيميل المنسّض وحساب دخوله؛ null لما مفيش يوزر بالإيميل ده. */
  findMemberByEmail(email: string): Promise<IdentityMemberAccount | null>;
  /** بيقرأ اليوزر اللي اتعمل من عملية دعوة في شركة معيّنة؛ null لما العملة دي ما خليتش أثر. */
  findMemberByInvitation(
    operationId: string,
    companyId: string,
  ): Promise<IdentityMemberAccount | null>;
  /** بيقرأ علامة الدعوة لليوزر؛ null لما مفيش يوزر بالمعرّف ده. */
  readInvitationMarker(userId: string): Promise<IdentityInvitationMarker | null>;
  /**
   * بينشئ المدعوّ ويوزر وحساب دخول من غير كلمة مرور في معاملة واحدة؛ إيميل مأخود بيرجّع
   * email-taken من غير ما يرقم، فالمتسابق على الإيميل بيرجّع الحساب الموجود.
   */
  createInvitedMember(input: InvitedMemberRow): Promise<InvitedMemberInsertion>;
  /** بيكتب صف verification، ويحذف قبله الصفوف اللي معرّفها بيبدأ بالبادئة لو اتبعتت. */
  writeVerificationRow(input: VerificationRow): Promise<void>;
}

const memberSummaryFields = {
  id: user.id,
  hasPassword: account.password,
};

/** الحساب الموجود مع حساب دخوله من غير كلمة مرور — صف واحد لأن (provider, account_id) فريد. */
function readWithCredential(db: PostgresJsDatabase<IdentitySchema>, where: SQL | undefined) {
  return db
    .select(memberSummaryFields)
    .from(user)
    .leftJoin(account, and(eq(account.userId, user.id), eq(account.providerId, 'credential')))
    .where(where)
    .limit(1);
}

const isUniqueViolation = (error: unknown, constraint: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === '23505' &&
  'constraint' in error &&
  (error as { constraint?: unknown }).constraint === constraint;

type MemberRows = { id: string; hasPassword: string | null }[];

const accountOf = (rows: MemberRows): IdentityMemberAccount | null => {
  const row = rows[0];
  return row === undefined ? null : { id: row.id, hasPassword: row.hasPassword !== null };
};

const findByEmail = async (
  db: PostgresJsDatabase<IdentitySchema>,
  email: string,
): Promise<IdentityMemberAccount | null> =>
  accountOf(await readWithCredential(db, eq(user.email, email)));

const findByInvitation = async (
  db: PostgresJsDatabase<IdentitySchema>,
  operationId: string,
  companyId: string,
): Promise<IdentityMemberAccount | null> =>
  accountOf(
    await readWithCredential(
      db,
      and(eq(user.invitationOperationId, operationId), eq(user.invitedByCompanyId, companyId)),
    ),
  );

const readInvitationMarker = async (
  db: PostgresJsDatabase<IdentitySchema>,
  userId: string,
): Promise<IdentityInvitationMarker | null> => {
  const rows = await db
    .select({ invitedByCompanyId: user.invitedByCompanyId, hasPassword: account.password })
    .from(user)
    .leftJoin(account, and(eq(account.userId, user.id), eq(account.providerId, 'credential')))
    .where(eq(user.id, userId))
    .limit(1);
  const row = rows[0];
  return row === undefined
    ? null
    : { invitedByCompanyId: row.invitedByCompanyId, hasPassword: row.hasPassword !== null };
};

const createInvitedMember = async (
  db: PostgresJsDatabase<IdentitySchema>,
  input: InvitedMemberRow,
): Promise<InvitedMemberInsertion> => {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: input.id,
        name: input.name,
        email: input.email,
        emailVerified: false,
        invitedByCompanyId: input.invitedByCompanyId,
        invitationOperationId: input.invitationOperationId,
        createdAt: input.now,
        updatedAt: input.now,
      });
      // حساب دخول من غير كلمة مرور: اليوزر ما يدخلش غير لما يحط كلمة مروره من الرابط.
      await tx.insert(account).values({
        id: input.accountId,
        accountId: input.id,
        providerId: 'credential',
        userId: input.id,
        createdAt: input.now,
        updatedAt: input.now,
      });
    });
  } catch (error) {
    if (!isUniqueViolation(error, 'user_email_key')) throw error;
    return 'email-taken';
  }
  return 'created';
};

const writeVerificationRow = async (
  db: PostgresJsDatabase<IdentitySchema>,
  input: VerificationRow,
): Promise<void> => {
  await db.transaction(async (tx) => {
    if (input.invalidatePrefix !== undefined) {
      await tx.delete(verification).where(
        and(
          eq(verification.value, input.value),
          like(verification.identifier, `${input.invalidatePrefix}%`),
        ),
      );
    }
    await tx.insert(verification).values({
      id: input.id,
      identifier: input.identifier,
      value: input.value,
      expiresAt: input.expiresAt,
      createdAt: input.now,
      updatedAt: input.now,
    });
  });
};

/**
 * حدود جداول الهوية لدعوة الأعضاء (G1): الإيميل بيتخزن صريح في جدول اليوزر زي أي حساب، وصف
 * الدعوة في الشركة بيحمل بصمته بس — فمفيش إيميل ولا توكن بيخرج من الجدول ده للـ tenant.
 *
 * @param db اتصال الهوية على pospay_auth
 * @returns القراءات والكتابات
 */
export function memberInvitationQueries(
  db: PostgresJsDatabase<IdentitySchema>,
): MemberInvitationQueries {
  return {
    findMemberByEmail: (email) => findByEmail(db, email),
    findMemberByInvitation: (operationId, companyId) =>
      findByInvitation(db, operationId, companyId),
    readInvitationMarker: (userId) => readInvitationMarker(db, userId),
    createInvitedMember: (input) => createInvitedMember(db, input),
    writeVerificationRow: (input) => writeVerificationRow(db, input),
  };
}
