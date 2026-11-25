import { z } from 'zod';

import { page } from '../pagination/cursor.js';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

/** الأدوار اللي بتتدى بالدعوة (IM-Q2) — دور المالك مش فيهم أبداً. */
export const invitableRole = z.enum([
  'general_manager',
  'business_manager',
  'branch_manager',
  'accountant',
]);

/** أنواع النطاق اللي بيحتاجها الدور. */
export const invitationScopeType = z.enum(['COMPANY', 'BUSINESS', 'BRANCH']);

/**
 * طلب دعوة عضو. التأكيد مطلوب دايماً (D10): الشاشة بتعرض الإيميل كامل وبتطلب علامة التأكيد قبل الإرسال،
 * سواء كان للحساب حساب موجود أو لأ.
 */
export const inviteMemberInput = z
  .strictObject({
    email: z.email().max(320),
    name: z.string().trim().min(1).max(255),
    role: invitableRole,
    scope: z.strictObject({ type: invitationScopeType, id }),
    email_confirmed: z.literal(true),
  })
  .meta({ id: 'InviteMemberInput' });

/** نتيجة الدعوة: الرابط بيتعرض مرة واحدة بس ومش بيرجع من أي مسار تاني (N1). */
export const memberInvitationResult = responseObject({
  invitation_id: id,
  set_password_link: z.string(),
}).meta({ id: 'MemberInvitationResult' });

/** نتيجة إنهاء العضوية: معرفها ووقت الانتهاء المحفوظ (نفس الوقت لو اتنهت قبل كده). */
export const endMembershipResult = responseObject({
  id,
  ends_at: timestamp,
}).meta({ id: 'EndMembershipResult' });

/** صف دعوة في القائمة — مفيش فيه رابط ولا توكن ولا إيميل صريح. */
export const memberInvitation = responseObject({
  id,
  role_code: z.string(),
  scope_type: invitationScopeType,
  scope_id: id,
  state: z.enum(['PENDING', 'ACTIVE', 'CANCELLED']),
  link_issued_at: timestamp.nullable(),
  created_at: timestamp,
  /** هل المتصل الحالي يقدر يصدر رابط جديد للدعوة دي (PENDING ومن نفس الداعي والعضوية مكتوبة). */
  can_reissue: z.boolean(),
}).meta({ id: 'MemberInvitation' });

/** صفحة دعوات الشركة. */
export const memberInvitationPage = page(memberInvitation).meta({ id: 'MemberInvitationPage' });

export type InvitableRole = z.infer<typeof invitableRole>;
export type InvitationScopeType = z.infer<typeof invitationScopeType>;
export type InviteMemberInput = z.infer<typeof inviteMemberInput>;
export type MemberInvitationResult = z.infer<typeof memberInvitationResult>;
export type EndMembershipResult = z.infer<typeof endMembershipResult>;
export type MemberInvitation = z.infer<typeof memberInvitation>;
export type MemberInvitationPage = z.infer<typeof memberInvitationPage>;
