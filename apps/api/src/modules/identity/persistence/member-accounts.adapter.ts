import type { AuthService } from '@pospay/auth';

import type { MemberAccounts, MemberPasswordState } from '../ports/member-invitations.port.ts';

/**
 * بيوقّف حدود جداول الهوية على خدمة الاعتماد — الخدمة الوحيدة اللي تقدر تلمس جداول Better Auth.
 *
 * @param auth خدمة الاعتماد
 * @returns حدود الحسابات والدعوات
 */
export function createMemberAccounts(auth: AuthService): MemberAccounts {
  return {
    hashEmail: (email) => auth.members.hashEmail(email),
    findByEmail: (email) => auth.members.findByEmail(email),
    findByInvitation: (operationId, companyId) =>
      auth.members.findByInvitation(operationId, companyId),
    createInvitedMember: (input) => auth.members.createInvitedMember(input),
    readMarker: (userId) => auth.members.readMarker(userId),
    issueInvitationLink: (input) => auth.members.issueInvitationLink(input),
  };
}

/**
 * بيقول إن العضو حط كلمة مروره — بيستعمل لعرض حالة الدعوة من غير ما نكتب في مسار القراءة.
 *
 * @param auth خدمة الاعتماد
 * @returns قارئ حالة كلمة المرور
 */
export function createMemberPasswordState(auth: AuthService): MemberPasswordState {
  return async (userId) => (await auth.members.readMarker(userId))?.hasPassword ?? false;
}
