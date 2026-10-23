import type { Tx } from '@pospay/db';
import { alertRule } from '../../settings/index.ts';
import type { AlertRulesPort } from '../ports/alert-rule.port.ts';

export function alertRules(tx: Tx): AlertRulesPort {
  return {
    rule: (companyId, scope, kind) => alertRule(tx, companyId, scope, kind),
  };
}
