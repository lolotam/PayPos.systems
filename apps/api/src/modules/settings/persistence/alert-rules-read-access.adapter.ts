import { readAlertRulesAccess } from '../../identity/index.ts';
import type { AlertRulesReadAccess } from '../ports/alert-rules.port.ts';

export function createAlertRulesReadAccess(): AlertRulesReadAccess {
  return {
    read: (tx, companyId, userId, target) => readAlertRulesAccess(tx, companyId, userId, target),
  };
}
