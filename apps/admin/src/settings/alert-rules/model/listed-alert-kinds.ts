import { alertKindAllowsBranchOverride } from '@pospay/domain';
import type { AlertRules } from '@pospay/contracts';

const LISTED_ALERT_KINDS = [
  'SHIFT_NOT_CLOCKED_IN',
  'SHIFT_BREAK_NOT_RETURNED',
  'SHIFT_BREAK_RETURNED_OTHER_BRANCH',
  'SHIFT_ENDS_SOON',
  'ATTENDANCE_EXCEPTION',
  'DOCUMENT_EXPIRING',
  'LATE_SERVICE_SESSION',
  'SERVICE_LINE_EDITED',
  'SERVICE_LINE_CANCELLED',
  'SERVICE_LINE_PERFORMERS_CHANGED',
  'ATTENDANCE_CHANGE_REQUESTED',
  'ATTENDANCE_CHANGE_DECIDED',
] as const;

export type ListedAlertKind = (typeof LISTED_ALERT_KINDS)[number];
export type AlertRuleView = AlertRules['rules'][number];
export type ListedAlertRuleView = AlertRuleView & { kind: ListedAlertKind };

// الأنواع دي بس اللي المُرسِلات بتاعتها بتقري AlertRulesPort النهارده؛ 62-2c بيضيف STATEMENT_*،
// و057-3b نوع الموافقة الذاتية على الخصم، و61-1 نوع LOW_RATING لما المُرسِلات تنتقل للمنفذ.
export function listedAlertKinds(
  rules: readonly AlertRuleView[],
  branchView: boolean,
): ListedAlertRuleView[] {
  return LISTED_ALERT_KINDS.flatMap((kind) => {
    const rule = rules.find((candidate) => candidate.kind === kind);
    if (!rule || (branchView && !alertKindAllowsBranchOverride(kind))) return [];
    return [{ ...rule, kind }];
  });
}
