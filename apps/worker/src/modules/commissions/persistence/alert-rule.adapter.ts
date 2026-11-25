import type { Tx } from '@pospay/db';

import { alertRule } from '../../settings/index.ts';
import type { StatementReminderAlertRulesReader } from '../ports/statement-reminder.port.ts';

/**
 * محوّل قاعدة التنبيه لموديول العمولات: القاعدة الفعلية بتحدد التشغيل والقناة بس
 * (DR-008)، والمسار بيقراها على معاملة الشركة نفسها.
 */
export const statementReminderAlertRules: StatementReminderAlertRulesReader<Tx> = (
  tx,
  companyId,
  scope,
  kind,
) => alertRule(tx, companyId, scope, kind);
