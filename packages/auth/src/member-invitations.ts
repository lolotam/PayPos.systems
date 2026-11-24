import { createHmac, randomBytes } from 'node:crypto';

import type { AuthDatabase } from '@pospay/db';

/**
 * الدومين المحجوز لإيميلات حسابات الموظفين (F1). أي إيميل تحته مش قابل للدعوة، لأن حساب
 * الموظفة مالوش كلمة مرور ولا دخول لإدارة.
 */
export const STAFF_SYNTHETIC_EMAIL_DOMAIN = 'staff.pospay.invalid';

/** عمر رابط الدعوة (48 ساعة) — IM-Q3؛ رابط الـ operator بيفضل ساعة. */
export const MEMBER_INVITATION_LINK_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * حال الإيميل بالنسبة لشركة داعية: FREE مفيش حساب، TAKEN له حساب (قرار N1: بيترفض أياً كان
 * مصدره)، OURS حساب اتنشأ من دعوة سابقة لنفس الشركة وما حطّش كلمة مرور — دي الحالة الوحيدة اللي الاستئناف بيعدّيها.
 */
export type EmailState =
  | { readonly kind: 'FREE' }
  | { readonly kind: 'TAKEN' }
  | { readonly kind: 'OURS'; readonly operationId: string };

/** نتيجة إنشاء حساب المدعوّ: هل الحساب اتعمل بهذه الدعوة ولا سبق له حساب بنفس الإيميل. */
export interface InvitedMemberOutcome {
  readonly userId: string;
  /** false لما سبق له حساب (سباق بين دعوتين) — الطلب بيترفض بـ N1. */
  readonly createdByInvitation: boolean;
}

/** الدعوة مرفوضة: المستخدم مش مدعو من الشركة دي، أو كلمة مروره اتحطت خلاص. */
export class InvitationLinkRefusedError extends Error {
  override readonly name = 'InvitationLinkRefusedError';
}

/** حدود جداول الهوية اللي الـ API بيستخدمها في الدعوة — كل SQL جوه packages/db. */
export interface MemberInvitationAccounts {
  /** بصمة الإيميل (HMAC) — الإيميل نفسه عمره ما بيتخزن في صف الدعوة ولا بيتبعت في log. */
  hashEmail(email: string): string;
  /** حال الإيميل لشركة داعية: حر، أو له حساب، أو حساب اتنشأ من دعوة سابقة لنفس الشركة. */
  inspectEmail(email: string, companyId: string): Promise<EmailState>;
  /** هل المستخدم حط كلمة مرور؛ false لمستخدم مش موجود. */
  hasPassword(userId: string): Promise<boolean>;
  /**
   * ينشئ حساب المدعوّ بحساب دخول من غير كلمة مرور وعلامته. نفس العملية بترجّع نفس الحساب
   * (ايدمبوتنس)، وإيميل له حساب بيرجّع createdByInvitation: false.
   */
  createInvitedMember(input: {
    operationId: string;
    companyId: string;
    email: string;
    name: string;
  }): Promise<InvitedMemberOutcome>;
  /** يصدر رابط تعيين كلمة مرور — بس لمستخدم دعته الشركة دي ومالوش كلمة مرور. */
  issueInvitationLink(input: {
    userId: string;
    companyId: string;
    redirectTo: string;
    lifetimeMs: number;
    now: Date;
  }): Promise<string>;
}

/** هل الإيميل تحت الدومين المحجوز لحسابات الموظفين (F1). */
export function isStaffSyntheticEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  return (
    at > 0 &&
    email
      .slice(at + 1)
      .trim()
      .toLowerCase() === STAFF_SYNTHETIC_EMAIL_DOMAIN
  );
}

const normalized = (email: string): string => email.trim().toLowerCase();

/** بصمة الإيميل: HMAC بمفتاح BETTER_AUTH_SECRET وبسياق ثابت عشان البصمة ما تتكسرش. */
function emailHasher(secret: string): (email: string) => string {
  return (email) =>
    createHmac('sha256', secret)
      .update('pospay:member-invitation:email:v1\0')
      .update(normalized(email))
      .digest('base64url');
}

type MemberQueries = AuthDatabase['memberInvitations'];

/** ينشئ حساب المدعوّ (ايدمبوتنس بمعرّف العملية)، ويحكم على سباق الإيميل من القراءة بعد التعارض. */
async function createInvitedMember(
  queries: MemberQueries,
  ids: { newId(): string },
  input: { operationId: string; companyId: string; email: string; name: string },
): Promise<InvitedMemberOutcome> {
  const existing = await queries.findMemberByInvitation(input.operationId, input.companyId);
  if (existing !== null) return { userId: existing.id, createdByInvitation: true };
  const email = normalized(input.email);
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
  if (insertion === 'created') return { userId, createdByInvitation: true };
  // تعارض على الإيميل: يا عملية متزامنة بنفس الدعوة كتبت الصف، يا حساب غريب سبقنا.
  const racedByOperation = await queries.findMemberByInvitation(input.operationId, input.companyId);
  if (racedByOperation !== null) return { userId: racedByOperation.id, createdByInvitation: true };
  const raced = await queries.findMemberByEmail(email);
  if (raced === null) throw new Error('invited member vanished after an insert conflict');
  return { userId: raced.id, createdByInvitation: false };
}

/**
 * بيبني حدود جداول الهوية لعملية الدعوة. الرابط بيتكتب بنفس شكل صف Better Auth
 * (`reset-password:<token>`)، فتخزين التوكن هو نفس تخزين أي رابط reset موجود قبل الدعوات.
 *
 * @param options قاعدة الهوية ومولّد الـ ids وسر البصمة وعنوان الـ auth
 * @returns حدود الدعوة
 */
export function createMemberInvitationAccounts(options: {
  database: AuthDatabase;
  ids: { newId(): string };
  secret: string;
  baseUrl: string;
}): MemberInvitationAccounts {
  const queries = options.database.memberInvitations;
  return {
    hashEmail: emailHasher(options.secret),
    inspectEmail: async (email, companyId) => {
      const owner = await queries.findMemberByEmail(normalized(email));
      if (owner === null) return { kind: 'FREE' };
      // الاستئناف بس لحساب اتنشأ من دعوة نفس الشركة ولسه ما حطش كلمة مرور؛ بعدها هو حساب موجود (N1).
      const resumable =
        owner.invitedByCompanyId === companyId &&
        owner.invitationOperationId !== null &&
        (await queries.readHasPassword(owner.id)) === false;
      return resumable && owner.invitationOperationId !== null
        ? { kind: 'OURS', operationId: owner.invitationOperationId }
        : { kind: 'TAKEN' };
    },
    hasPassword: async (userId) => (await queries.readHasPassword(userId)) === true,
    createInvitedMember: (input) => createInvitedMember(queries, options.ids, input),
    issueInvitationLink: async (input) => {
      const token = randomBytes(24).toString('base64url');
      const issued = await queries.issueInvitationLink({
        id: options.ids.newId(),
        identifier: `reset-password:${token}`,
        companyId: input.companyId,
        userId: input.userId,
        expiresAt: new Date(input.now.getTime() + input.lifetimeMs),
        now: input.now,
      });
      if (!issued) throw new InvitationLinkRefusedError();
      return `${options.baseUrl}/reset-password/${token}?callbackURL=${encodeURIComponent(input.redirectTo)}`;
    },
  };
}
