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

/** نتيجة كتابة المدعوّ: الصف اتبنى، أو تعارض فريد (نفس الإيميل أو نفس العملية) والصف قديم. */
export type InvitedMemberInsertion = 'created' | 'conflict';

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

/**
 * مدخلات إصدار رابط الدعوة في معاملة واحدة: قفل صف اليوزر، فحص العلامة («عمري ما اتدعيت
 * من شركة تانية» و«مفيش كلمة مرور»)، وإبطال الروابط القديمة والكتابة — ذري ضد السباق مع
 * استهلاك الرابط.
 */
export interface InvitationLinkRow {
  readonly id: string;
  readonly identifier: string;
  readonly value: string;
  readonly companyId: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly now: Date;
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
   * بينشئ المدعوّ ويوزر وحساب دخول من غير كلمة مرور في معاملة واحدة؛ تعارض فريد (نفس
   * الإيميل أو نفس العملية) بيرجّع conflict من غير ما يرقم، فالمتصل بيعيد القراءة ويحكم.
   */
  createInvitedMember(input: InvitedMemberRow): Promise<InvitedMemberInsertion>;
  /** بيكتب صف verification، ويحذف قبله الصفوف اللي معرّفها بيبدأ بالبادئة لو اتبعتت. */
  writeVerificationRow(input: VerificationRow): Promise<void>;
  /**
   * بيصدر رابط الدعوة في معاملة واحدة تحت قفل صف اليوزر: بيرفض لو اليوزر مش مدعوّ من
   * الشركة دي أو كلمة مروره اتحطت، وبيبطل الروابط القديمة قبل الكتابة.
   *
   * @returns true لما الرابط اتكتب، وfalse لما الإصدار مرفوض
   */
  issueInvitationLink(input: InvitationLinkRow): Promise<boolean>;
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
  const inserted = await db.transaction(async (tx) => {
    // تعارض فريد (الإيميل أو معرّف العملية) بيرجّع بدون استثناء، فمعاملة ما بتتبطلش.
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
      .onConflictDoNothing()
      .returning({ id: user.id });
    if (rows.length === 0) return 'conflict' as const;
    // حساب دخول من غير كلمة مرور: اليوزر ما يدخلش غير لما يحط كلمة مروره من الرابط.
    await tx.insert(account).values({
      id: input.accountId,
      accountId: input.id,
      providerId: 'credential',
      userId: input.id,
      createdAt: input.now,
      updatedAt: input.now,
    });
    return 'created' as const;
  });
  return inserted;
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

/** صف اليوزر تحت القفل: الشركة الداعية وهل حساب الدخول شايل كلمة مرور. */
type LockedMarker = { invitedByCompanyId: string | null; password: string | null };

const issueInvitationLink = async (
  db: PostgresJsDatabase<IdentitySchema>,
  input: InvitationLinkRow,
): Promise<boolean> => {
  return db.transaction(async (tx) => {
    const [marker] = await tx
      .select({ invitedByCompanyId: user.invitedByCompanyId, password: account.password })
      .from(user)
      .leftJoin(account, and(eq(account.userId, user.id), eq(account.providerId, 'credential')))
      .where(eq(user.id, input.userId))
      .for('update')
      .limit(1);
    const locked = marker as LockedMarker | undefined;
    if (locked === undefined || locked.invitedByCompanyId !== input.companyId) return false;
    if (locked.password !== null) return false;
    await tx.delete(verification).where(
      and(
        eq(verification.value, input.userId),
        like(verification.identifier, 'reset-password:%'),
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
    issueInvitationLink: (input) => issueInvitationLink(db, input),
  };
}
