import type { Tx } from '@pospay/db';

import { readBranchRoleHolders, teamAlertRecipientContacts } from '../../identity/index.ts';
import { readAlertRule } from '../../settings/index.ts';
import type { AlertRulesPort } from '../ports/alert-rules.port.ts';

// القاعدتين بتتقري على معاملة المُرسِل نفسها، عشان قرار الإشعار يتبني على نفس البيانات اللي باقي الكتابة شايفها.
export const attendanceChangeAlertRules: AlertRulesPort = {
  rule: (tx, companyId, scope, kind) => readAlertRule(tx, companyId, scope, kind),
  roleHolders: (tx, companyId, scope, roles, at) =>
    readBranchRoleHolders(tx, companyId, scope.businessId, scope.branchId, roles, at),
  contacts: (tx, companyId, userIds, at) => teamAlertRecipientContacts(tx, companyId, userIds, at),
};

/**
 * بريد جهات اتصال أعضاء الشركة: نفس قراءة التنبيهات، بس من غير شرط البريد الموثّق.
 * بتستخدمها بريد الترحيب: الموظفة الجديدة مالها بريد مؤكد لسه، فالمشروط بيبقّيه.
 *
 * @param tx        معاملة الشركة
 * @param companyId الشركة
 * @param userIds   المستخدمين المطلوبين
 * @param at        لحظة نافذة العضوية
 * @returns جهة اتصال لكل مستخدم عنده بريد
 */
export async function readStaffMemberEmailContacts(
  tx: Tx,
  companyId: string,
  userIds: readonly string[],
  at: Date,
): Promise<Map<string, { readonly email: string | null; readonly phoneNumber: string | null }>> {
  return teamAlertRecipientContacts(tx, companyId, userIds, at, { requireVerifiedEmail: false });
}
