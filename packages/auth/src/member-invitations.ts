import { createHmac, randomBytes } from 'node:crypto';

import type { AuthDatabase, MemberInvitationQueries } from '@pospay/db';

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

/** نتيجة إنشاء حساب المدعوّ: هل الحساب ده اتعمل من الدعوة دي ولا كان موجود قبلها. */
export interface InvitedMemberOutcome {
  readonly userId: string;
  /** true لما الحساب اتعمل بهذه الدعوة (companyId + operationId)؛ false لما كان حساب موجود. */
  readonly createdByInvitation: boolean;
}

/** علامة الدعوة على اليوزر: الشركة اللي تقدر تصدر رابط، وهل كلمة المرور اتحطت. */
export interface MemberInvitationMarker {
  readonly invitedByCompanyId: string | null;
  readonly hasPassword: boolean;
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
    ...(options.invalidatePrevious === true
      ? { invalidatePrefix: 'reset-password:' }
      : {}),
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
): MemberAccountSummary | null => (found === null ? null : { userId: found.id, hasPassword: found.hasPassword });

/** القارئ بالإيميل والقارئ بمعرّف العملية: نفس ملخص الحساب من جداول الهوية. */
function accountReaders(queries: MemberInvitationQueries) {
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
  queries: MemberInvitationQueries,
  userId: string,
): Promise<MemberInvitationMarker | null> {
  const marker = await queries.readInvitationMarker(userId);
  return marker === null
    ? null
    : { invitedByCompanyId: marker.invitedByCompanyId, hasPassword: marker.hasPassword };
}

/** ينشئ حساب المدعوّ بحساب دخول من غير كلمة مرور، أو بيرجّع الحساب الموجود (ايدمبوتنس بالعملية). */
async function createInvitedMember(
  queries: MemberInvitationQueries,
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
  if (insertion === 'email-taken') {
    // سباق على نفس الإيميل: الفايز اتبنى قبله، فالحساب الموجود هو نفسه نتيجة الطلب ده.
    const raced = await readers.findByEmail(email);
    if (raced === null) throw new Error('invited member vanished after an email-key race');
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
  const marker = await readMarker(database.memberInvitations, input.userId);
  if (marker === null) throw new InvitationLinkRefusedError();
  if (marker.invitedByCompanyId !== input.companyId) throw new InvitationLinkRefusedError();
  if (marker.hasPassword) throw new InvitationLinkRefusedError();
  return issueSetPasswordLink(database, ids, baseUrl, input.userId, input.redirectTo, {
    ...(input.lifetimeMs === undefined ? {} : { lifetimeMs: input.lifetimeMs }),
    ...(input.now === undefined ? {} : { now: input.now }),
    invalidatePrevious: true,
  });
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
    createInvitedMember: (input) => createInvitedMember(queries, options.ids, readers, input),
    readMarker: (userId) => readMarker(queries, userId),
    issueInvitationLink: (input) =>
      issueInvitationLink(options.database, options.ids, options.baseUrl, input),
  };
}
