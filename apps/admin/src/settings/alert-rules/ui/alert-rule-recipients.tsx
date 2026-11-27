'use client';

import { ALERT_KIND_DEFINITIONS } from '@pospay/domain';
import { alertChannel, alertRecipientRole, type SetAlertRulesInput } from '@pospay/contracts';
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
type RuleChannel = (typeof alertChannel.options)[number];

const CHANNEL_LABEL_KEYS = {
  IN_APP: 'alertRules.channelInApp',
  EMAIL: 'alertRules.channelEmail',
  WHATSAPP: 'alertRules.channelWhatsapp',
} as const satisfies Record<RuleChannel, string>;

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

function toggledChannels(selected: readonly RuleChannel[], channel: RuleChannel): RuleChannel[] {
  const next = selected.includes(channel)
    ? selected.filter((value) => value !== channel)
    : [...selected, channel];
  return alertChannel.options.filter((value) => next.includes(value));
}

// قنوات الفريق: الجرس والإيميل والواتساب، والواتساب جنبه ملاحظة ظاهرة إن الإرسال بيه لسه مش مفعّل (ADR-0018 §11).
function AlertRuleChannels({
  rule,
  index,
  disabled,
}: {
  rule: ListedAlertRuleView;
  index: number;
  disabled: boolean;
}) {
  const locale = useLocale();
  const { field } = useController<SetAlertRulesInput, `rules.${number}.channels`>({
    name: `rules.${index}.channels`,
  });
  const selected = field.value;
  const kind = alertRuleKindLabel(locale, rule.kind);
  return (
    <div
      role="group"
      aria-label={t(locale, 'alertRules.channelsLabel')}
      className="flex flex-col gap-2"
    >
      <p className="text-sm font-semibold">{t(locale, 'alertRules.channelsLabel')}</p>
      {alertChannel.options.map((channel) => {
        const id = `alert-rule-${index}-channel-${channel}`;
        const channelLabel = t(locale, CHANNEL_LABEL_KEYS[channel]);
        const noteId = `${id}-note`;
        return (
          <div key={channel} className="flex flex-wrap items-center gap-2">
            <input
              id={id}
              type="checkbox"
              aria-label={alertRulesText(t(locale, 'alertRules.channelForKind'), {
                channel: channelLabel,
                kind,
              })}
              {...(channel === 'WHATSAPP' ? { 'aria-describedby': noteId } : {})}
              checked={selected.includes(channel)}
              disabled={disabled}
              onChange={() => field.onChange(toggledChannels(selected, channel))}
            />
            <Label htmlFor={id}>{channelLabel}</Label>
            {channel === 'WHATSAPP' ? (
              <p id={noteId} className="text-sm text-muted-foreground">
                {t(locale, 'alertRules.channelWhatsappUnconfiguredNote')}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function AlertRuleRoleChoices({
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
  return (
    <div
      role="group"
      aria-label={t(locale, 'alertRules.recipientsTitle')}
      className="flex flex-col gap-2"
    >
      {selectableRoles.map((role) => {
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
              onChange={() => field.onChange(toggledRoles(selected, role))}
            />
            <Label htmlFor={id}>{roleLabel}</Label>
          </div>
        );
      })}
    </div>
  );
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
  const { employeeOnly } = ALERT_KIND_DEFINITIONS[rule.kind];
  const showRoleChoices = !employeeOnly && !PERMISSION_FIXED_KINDS.has(rule.kind);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">{t(locale, 'alertRules.recipientsTitle')}</p>
      {showRoleChoices ? (
        <AlertRuleRoleChoices rule={rule} index={index} disabled={disabled} />
      ) : null}
      {fixedRecipientsFor(rule).map((recipient, recipientIndex) => {
        const text = fixedText(locale, recipient);
        return text === null ? null : (
          <p key={recipientIndex} className="text-sm text-muted-foreground">
            {text}
          </p>
        );
      })}
      {employeeOnly ? null : <AlertRuleChannels rule={rule} index={index} disabled={disabled} />}
    </div>
  );
}
