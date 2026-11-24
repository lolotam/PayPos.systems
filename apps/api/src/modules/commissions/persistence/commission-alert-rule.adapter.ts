import { readAlertRule } from '../../settings/index.ts';
import type { AlertRulesPort } from '../ports/alert-rules.port.ts';

// القاعدة بتتقري على معاملة المُرسِل نفسها، عشان قرار الإشعار يتبني على نفس البيانات اللي باقي الكتابة شايفها.
export const commissionAlertRules: AlertRulesPort = {
  rule: (tx, companyId, scope, kind) => readAlertRule(tx, companyId, scope, kind),
};
