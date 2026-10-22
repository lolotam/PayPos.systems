import { readBranchRoleHolders } from '../../identity/index.ts';
import { readAlertRule } from '../../settings/index.ts';
import type { AlertRulesPort } from '../ports/alert-rules.port.ts';

// القاعدتين بتتقري على معاملة المُرسِل نفسها، عشان قرار الإشعار يتبني على نفس البيانات اللي باقي الكتابة شايفها.
export const attendanceChangeAlertRules: AlertRulesPort = {
  rule: (tx, companyId, scope, kind) => readAlertRule(tx, companyId, scope, kind),
  roleHolders: (tx, companyId, scope, roles, at) =>
    readBranchRoleHolders(tx, companyId, scope.businessId, scope.branchId, roles, at),
};
