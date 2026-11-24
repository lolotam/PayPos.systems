import { createHmac, randomBytes } from 'node:crypto';

import type { AuthDatabase } from '@pospay/db';

type MemberQueries = AuthDatabase['memberInvitations'];

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

/** نتيجة إنشاء حساب المدعوّ: هل الحساب اتعمل بهذه الدعوة ولا سبق له حساب بنفس الإيميل. */
export interface InvitedMemberOutcome {
  readonly userId: string;
  /** true لما الحساب اتعمل بهذه الدعوة؛ false لما سبق له حساب (تحت قرار N1 بيترفض الطلب). */
  readonly createdByInvitation: boolean;
}

/** خيارات رابط تعيين كلمة المرور: العمر والساعة، وهل نُبطل الروابط القديمة للليوزر. */
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

/** حدود جداول الهوية اللي الـ API بيستخدمها في الدعوة — كل SQL جوه packages/db. */
export interface MemberInvitationAccounts {
  /** بصمة الإيميل (HMAC) — الإيميل نفسه عمره ما بيتخزن في صف الدعوة ولا بيتبعت في log. */
  hashEmail(email: string): string;
  /** يقرأ حساب بالإيميل؛ null لو مفيش. */
  findByEmail(email: string): Promise<MemberAccountSummary | null>;
  /** يقرأ اليوزر اللي اتعمل من عملية دعوة معيّنة في الشركة دي؛ null لو مفيش. */
  findByInvitation(
    operationId: string,
    companyId: string,
  ): Promise<MemberAccountSummary | null>;
  /** يقرأ علامة الدعوة على اليوزر: الشركة اللي دعته، وهل كلمة المرور اتحطت. */
  readMarker(userId: string): Promise<MemberAccountSummary & { invitedByCompanyId: string | null } | null>;
  /**
   * ينشئ حساب المدعوّ بحساب دخول من غير كلمة مرور وعلامته. لو سبق له حساب بنفس الإيميل أو
   * نفس العملية بيرجّع الحساب الموجود و createdByInvitation: false، والحكم عليه عند المتصل.
   */
  createInvitedMember(input: {
    operationId: string;
    companyId: string;
    email: string;
    name: string;
  }): Promise<InvitedMemberOutcome>;
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

/**
 * يبني رابط تعيين كلمة المرور: بيكتب صف verification بنفس الشكل اللي Better Auth بيستهلكه في
 * POST /reset-password، وبيطير الروابط القديمة لليوزر لو اتطلب. الـ SQL كله على الـ facade
 * بتاع packages/db، والباكدج دي ما بتستوردش drizzle-orm أبداً.
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
  await database.memberInvitations.writeVerificationRow({
    id: ids.newId(),
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(now.getTime() + lifetime),
    now,
    ...(options.invalidatePrevious === true ? { invalidatePrefix: 'reset-password:' } : {}),
  });
  return `${baseUrl}/reset-password/${token}?callbackURL=${encodeURIComponent(redirectTo)}`;
}

/** بصمة الإيميل للحساب: HMAC بمفتاح BETTER_AUTH_SECRET وبسياق ثابت عشان البصمة ما تتكسرش. */
function emailHasher(secret: string): (email: string) => string {
  return (email) =>
    createHmac('sha256', secret)
      .update('pospay:member-invitation:email:v1\0')
      .update(normalized(email))
      .digest('base64url');
}

const toSummary = (
  found: { id: string; hasPassword: boolean } | null,
): MemberAccountSummary | null =>
  found === null ? null : { userId: found.id, hasPassword: found.hasPassword };

/** القارئ بالإيميل والقارئ بمعرّف العملية: نفس ملخص الحساب من جداول الهوية. */
function accountReaders(queries: MemberQueries) {
  const findByEmail = async (email: string): Promise<MemberAccountSummary | null> =>
    toSummary(await queries.findMemberByEmail(normalized(email)));
  const findByInvitation = async (
    operationId: string,
    companyId: string,
  ): Promise<MemberAccountSummary | null> =>
    toSummary(await queries.findMemberByInvitation(operationId, companyId));
  return { findByEmail, findByInvitation };
}

/** قارئ علامة الدعوة: الشركة اللي تقدر تصدر رابط، وهل كلمة المرور اتحطت. */
async function readMarker(
  queries: MemberQueries,
  userId: string,
): Promise<(MemberAccountSummary & { invitedByCompanyId: string | null }) | null> {
  const marker = await queries.readInvitationMarker(userId);
  return marker === null
    ? null
    : {
        userId,
        hasPassword: marker.hasPassword,
        invitedByCompanyId: marker.invitedByCompanyId,
      };
}

/** ينشئ حساب المدعوّ بحساب دخول من غير كلمة مرور، أو بيرجّع الحساب الموجود (ايدمبوتنس بالعملية). */
async function createInvitedMember(
  queries: MemberQueries,
  ids: { newId(): string },
  readers: { findByEmail(email: string): Promise<MemberAccountSummary | null> },
  input: { operationId: string; companyId: string; email: string; name: string },
): Promise<InvitedMemberOutcome> {
  const byOperation = await queries.findMemberByInvitation(input.operationId, input.companyId);
  if (byOperation !== null) return { userId: byOperation.id, createdByInvitation: true };
  const email = normalized(input.email);
  const existing = await readers.findByEmail(email);
  if (existing !== null) return { userId: existing.userId, createdByInvitation: false };
  const userId = ids.newId();
  const insertion = await queries.createInvitedMember({
    id: userId,
    accountId: ids.newId(),
    email,
    name: input.name,
    invitedByCompanyId: input.companyId,
    invitationOperationId: input.operationId,
    now: new Date(),
  });
  if (insertion === 'conflict') {
    // سباق على نفس الإيميل أو نفس العملية: القديم كتب صف اليوزر، فنقرأه ونحكم عند المتصل —
    // تحت قرار N1 الحساب الموجود بيرفض الطلب بدل ما يتضاف له عضوية.
    const racedByOperation = await queries.findMemberByInvitation(input.operationId, input.companyId);
    if (racedByOperation !== null) return { userId: racedByOperation.id, createdByInvitation: true };
    const raced = await readers.findByEmail(email);
    if (raced === null) throw new Error('invited member vanished after an insert conflict');
    return { userId: raced.userId, createdByInvitation: false };
  }
  return { userId, createdByInvitation: true };
}

/** يصدر رابط تعيين كلمة المرور — بس لليوزر اللي دعته الشركة دي واللي مالوش كلمة مرور. */
async function issueInvitationLink(
  database: AuthDatabase,
  ids: { newId(): string },
  baseUrl: string,
  input: {
    userId: string;
    companyId: string;
    redirectTo: string;
    lifetimeMs?: number;
    now?: Date;
  },
): Promise<string> {
  const lifetime = input.lifetimeMs ?? PASSWORD_SET_LINK_TTL_MS;
  const now = input.now ?? new Date();
  const token = randomBytes(24).toString('base64url');
  // الإصدار ذري تحت قفل صف اليوزر: فحص «عمري ما حطيت كلمة مروري» بيتم في نفس المعاملة
  // اللي بيكتب الرابط، فالاستهلاك المتزامن يا بيكمل قبله (فبنرفض) يا بيتأخر بعده.
  const issued = await database.memberInvitations.issueInvitationLink({
    id: ids.newId(),
    identifier: `reset-password:${token}`,
    value: input.userId,
    companyId: input.companyId,
    userId: input.userId,
    expiresAt: new Date(now.getTime() + lifetime),
    now,
  });
  if (!issued) throw new InvitationLinkRefusedError();
  return `${baseUrl}/reset-password/${token}?callbackURL=${encodeURIComponent(input.redirectTo)}`;
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
  const queries = options.database.memberInvitations;
  const readers = accountReaders(queries);
  return {
    hashEmail: emailHasher(options.secret),
    findByEmail: readers.findByEmail,
    findByInvitation: readers.findByInvitation,
    readMarker: (userId) => readMarker(queries, userId),
    createInvitedMember: (input) => createInvitedMember(queries, options.ids, readers, input),
    issueInvitationLink: (input) =>
      issueInvitationLink(options.database, options.ids, options.baseUrl, input),
  };
}
