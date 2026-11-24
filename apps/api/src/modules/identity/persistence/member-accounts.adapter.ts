import { InvitationLinkRefusedError, isStaffSyntheticEmail, type AuthService } from '@pospay/auth';

import { MemberLinkRefusedError, type MemberAccounts } from '../ports/member-invitations.port.ts';

/**
 * بيوقّف حدود جداول الهوية على خدمة الاعتماد — الخدمة الوحيدة اللي تقدر تلمس جداول Better Auth.
 * رفض الإصدار بيتحول لخطأ مملوك للـ port عشان الـ use case ما يستوردش تفاصيل packages/auth.
 *
 * @param auth خدمة الاعتماد
 * @returns حدود الحسابات والدعوات
 */
export function createMemberAccounts(auth: AuthService): MemberAccounts {
  return {
    hashEmail: (email) => auth.members.hashEmail(email),
    isStaffEmail: (email) => isStaffSyntheticEmail(email),
    inspectEmail: (email, companyId) => auth.members.inspectEmail(email, companyId),
    createInvitedMember: (input) => auth.members.createInvitedMember(input),
    discardInvitedMember: (input) => auth.members.discardInvitedMember(input),
    issueLink: async (input) => {
      try {
        return await auth.members.issueInvitationLink(input);
      } catch (error) {
        if (error instanceof InvitationLinkRefusedError) throw new MemberLinkRefusedError();
        throw error;
      }
    },
  };
}
