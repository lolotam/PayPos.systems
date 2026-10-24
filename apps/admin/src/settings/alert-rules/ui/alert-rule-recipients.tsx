'use client';

import { ALERT_KIND_DEFINITIONS } from '@pospay/domain';
import { alertRecipientRole, type SetAlertRulesInput } from '@pospay/contracts';
import { permissionName, roleName, t, type Locale } from '@pospay/i18n';
import { Label } from '@pospay/ui';
import { useController } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { alertRuleKindLabel, alertRulesText } from '../model/alert-rules-draft';
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
  const { field } = useController<SetAlertRulesInput>({ name: `rules.${index}.recipient_roles` });
  const selected = field.value;
  const kind = alertRuleKindLabel(locale, rule.kind);
  const toggle = (role: (typeof alertRecipientRole.options)[number]) => {
    const next = selected.includes(role)
      ? selected.filter((value) => value !== role)
      : [...selected, role];
    field.onChange(alertRecipientRole.options.filter((value) => next.includes(value)));
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">{t(locale, 'alertRules.recipientsTitle')}</p>
      {!ALERT_KIND_DEFINITIONS[rule.kind].employeeOnly
        ? alertRecipientRole.options.map((role) => {
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
      {rule.fixed_recipients.map((recipient, recipientIndex) => (
        <p key={recipientIndex} className="text-sm text-muted-foreground">
          {fixedText(locale, recipient)}
        </p>
      ))}
      {rule.channels.includes('IN_APP') ? (
        <p className="text-sm text-muted-foreground">{t(locale, 'alertRules.channelInApp')}</p>
      ) : null}
    </div>
  );
}
