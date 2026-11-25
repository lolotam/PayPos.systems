'use client';

import { ALERT_KIND_DEFINITIONS } from '@pospay/domain';
import { alertRecipientRole, type SetAlertRulesInput } from '@pospay/contracts';
import { permissionName, roleName, t, type Locale } from '@pospay/i18n';
import { Label } from '@pospay/ui';
import { useController } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { alertRuleKindLabel, alertRulesText } from '../model/alert-rules-text';
import type { ListedAlertRuleView } from '../model/listed-alert-kinds';

type FixedRecipient = ListedAlertRuleView['fixed_recipients'][number];

function fixedText(locale: Locale, recipient: FixedRecipient): string | null {
  if (recipient.selector === 'PERMISSION_HOLDERS' && recipient.permission) {
    return alertRulesText(t(locale, 'alertRules.fixedPermission'), {
      permission: permissionName(locale, recipient.permission),
    });
  }
  if (recipient.selector === 'CONTEXT' && recipient.who === 'REQUESTER') {
    return t(locale, 'alertRules.fixedRequester');
  }
  if (recipient.selector === 'CONTEXT' && recipient.who === 'EMPLOYEE') {
    return t(locale, 'alertRules.fixedEmployee');
  }
  if (recipient.selector === 'EMPLOYEE_PUSH') return t(locale, 'alertRules.fixedEmployeePush');
  return null;
}

type RecipientRole = (typeof alertRecipientRole.options)[number];

// تنبيهات الكشوف مستلموها ثابتون بأصحاب الصلاحية (DR-008)، فلا تُعرَض مربعات أدوار لا تغيّر شيئًا.
const PERMISSION_FIXED_KINDS = new Set<ListedAlertRuleView['kind']>([
  'STATEMENT_AWAITING_REVIEW',
  'STATEMENT_AWAITING_APPROVAL',
]);

function fixedRecipientsFor(rule: ListedAlertRuleView): readonly FixedRecipient[] {
  if (
    rule.kind === 'STATEMENT_AWAITING_APPROVAL' &&
    !rule.fixed_recipients.some((recipient) => recipient.selector === 'PERMISSION_HOLDERS')
  ) {
    return [
      ...rule.fixed_recipients,
      { selector: 'PERMISSION_HOLDERS', permission: 'approve:commissions:business', who: null },
    ];
  }
  return rule.fixed_recipients;
}

function toggledRoles(selected: readonly RecipientRole[], role: RecipientRole): RecipientRole[] {
  const next = selected.includes(role)
    ? selected.filter((value) => value !== role)
    : [...selected, role];
  return alertRecipientRole.options.filter((value) => next.includes(value));
}

export function AlertRuleRecipients({
  rule,
  index,
  disabled,
}: {
  rule: ListedAlertRuleView;
  index: number;
  disabled: boolean;
}) {
  const locale = useLocale();
  const { field } = useController<SetAlertRulesInput, `rules.${number}.recipient_roles`>({
    name: `rules.${index}.recipient_roles`,
  });
  const selected = field.value;
  const kind = alertRuleKindLabel(locale, rule.kind);
  const refused = ALERT_KIND_DEFINITIONS[rule.kind].refusedRecipientRoles;
  const selectableRoles = alertRecipientRole.options.filter((role) => !refused.includes(role));
  const showRoleChoices =
    !ALERT_KIND_DEFINITIONS[rule.kind].employeeOnly && !PERMISSION_FIXED_KINDS.has(rule.kind);
  const toggle = (role: RecipientRole) => field.onChange(toggledRoles(selected, role));
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">{t(locale, 'alertRules.recipientsTitle')}</p>
      {showRoleChoices
        ? selectableRoles.map((role) => {
            const id = `alert-rule-${index}-${role}`;
            const roleLabel = roleName(locale, role, role);
            return (
              <div key={role} className="flex items-center gap-2">
                <input
                  id={id}
                  type="checkbox"
                  aria-label={alertRulesText(t(locale, 'alertRules.roleForKind'), {
                    role: roleLabel,
                    kind,
                  })}
                  checked={selected.includes(role)}
                  disabled={disabled}
                  onChange={() => toggle(role)}
                />
                <Label htmlFor={id}>{roleLabel}</Label>
              </div>
            );
          })
        : null}
      {fixedRecipientsFor(rule).map((recipient, recipientIndex) => {
        const text = fixedText(locale, recipient);
        return text === null ? null : (
          <p key={recipientIndex} className="text-sm text-muted-foreground">
            {text}
          </p>
        );
      })}
      {rule.channels.includes('IN_APP') ? (
        <p className="text-sm text-muted-foreground">{t(locale, 'alertRules.channelInApp')}</p>
      ) : null}
    </div>
  );
}
