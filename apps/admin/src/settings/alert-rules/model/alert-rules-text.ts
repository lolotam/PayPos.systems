import { t, type Locale } from '@pospay/i18n';
import type { ListedAlertKind } from './listed-alert-kinds';

export function alertRuleKindLabel(locale: Locale, kind: ListedAlertKind): string {
  return t(locale, `alertRules.kind_${kind}`);
}

export function alertRulesText(template: string, values: Readonly<Record<string, string>>): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
    template,
  );
}
