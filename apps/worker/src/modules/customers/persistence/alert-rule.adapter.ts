import type { Tx } from '@pospay/db';
import { alertRule } from '../../settings/index.ts';
import type { AlertRulePort } from '../ports/low-rating-notice.ports.ts';

export function alertRules(tx: Tx): AlertRulePort {
  return {
    rule: (companyId, scope, kind) => alertRule(tx, companyId, scope, kind),
  };
}
