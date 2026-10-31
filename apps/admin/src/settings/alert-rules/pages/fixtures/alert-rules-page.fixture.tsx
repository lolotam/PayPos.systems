import { ALERT_KIND_DEFINITIONS } from '@pospay/domain';
import { alertKind, type AlertRules, type WorkspaceBranch } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { alertRuleKindLabel, alertRulesText } from '../../model/alert-rules-text';
import type { ListedAlertKind } from '../../model/listed-alert-kinds';
import { AlertRulesPage } from '../alert-rules-page';

export const companyId = '01920000-0000-7000-8000-0000000000a2';
export const userId = '01920000-0000-7000-8000-0000000000a3';
export const businessId = '01920000-0000-7000-8000-0000000000a4';
export const branchA: WorkspaceBranch = {
  id: '01920000-0000-7000-8000-0000000000a5',
  name_ar: null,
  name_en: 'Branch A',
  effective_timezone: 'Asia/Kuwait',
  is_active: true,
};
export const branchB: WorkspaceBranch = {
  id: '01920000-0000-7000-8000-0000000000a6',
  name_ar: null,
  name_en: 'Branch B',
  effective_timezone: 'Asia/Kuwait',
  is_active: true,
};

export function alertRulesFixture(overrides: Partial<AlertRules> = {}): AlertRules {
  const rules = alertKind.options.map((kind) => {
    const definition = ALERT_KIND_DEFINITIONS[kind];
    return {
      kind,
      source: 'DEFAULT' as const,
      enabled: definition.defaults.enabled,
      recipient_roles: [...definition.defaults.recipientRoles],
      channels: [...definition.defaults.channels],
      delay_minutes: definition.defaults.delayMinutes,
      lead_minutes: definition.defaults.leadMinutes,
      fixed_recipients: definition.fixedRecipients.map((recipient) => ({
        selector: recipient.selector,
        permission: 'permission' in recipient ? recipient.permission : null,
        who: 'who' in recipient ? recipient.who : null,
      })),
      revision: null,
      rule_id: null,
    };
  });
  return { business_id: businessId, branch_id: null, alerts_enabled: true, rules, ...overrides };
}

export function withAlertRule(
  view: AlertRules,
  kind: ListedAlertKind,
  overrides: Partial<AlertRules['rules'][number]>,
): AlertRules {
  return {
    ...view,
    rules: view.rules.map((rule) => (rule.kind === kind ? { ...rule, ...overrides } : rule)),
  };
}

export function refusal(status: number) {
  return {
    error: { code: 'FORBIDDEN', message_ar: 'Synthetic refusal', message_en: 'Synthetic refusal' },
    response: { status },
  };
}

/** مسار كارت طلبات التقييم: مسار تاني، مش جزء من مسار التنبيهات. */
export const ratingSettingsPath = '/v1/businesses/{businessId}/rating-settings';

/**
 * كارت طلبات التقييم له مساره، فالـ mock بيردّ عليه برفض 403 افتراضياً؛ اختبارات التنبيهات
 * ما تشوفش الكارت خالص. العدّاد بيعدّ قراءات التنبيهات بس، فترتيب القراءات ما يتغيّرش،
 * والاختبار اللي عايز ردّ مختلف على مسار التقييم بيبعتّله ردّه.
 *
 * @param resolve ردّ اختبارات التنبيهات، والمعامل الثاني عدد القراءات
 * @param rating  ردّ مسار طلبات التقييم
 * @returns دالة الردّ للـ mock
 */
export function mockAlertRulesGet(
  resolve: (path: string, call: number) => unknown,
  rating: unknown = refusal(403),
): (path: string) => unknown {
  let calls = 0;
  return (path: string) => {
    if (path === ratingSettingsPath) return rating;
    const answer = resolve(path, calls);
    calls += 1;
    return answer;
  };
}

export function renderPage({ branches = [] }: { branches?: readonly WorkspaceBranch[] } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <AlertRulesPage
          companyId={companyId}
          userId={userId}
          businessId={businessId}
          branches={branches}
        />
      </QueryClientProvider>,
    ),
  };
}

export function kindSwitch(kind: ListedAlertKind, locale: Locale = 'en'): HTMLInputElement {
  return screen.getByRole('switch', { name: alertRuleKindLabel(locale, kind) }) as HTMLInputElement;
}

export function kindRow(kind: ListedAlertKind, locale: Locale = 'en'): HTMLElement {
  const row = kindSwitch(kind, locale).closest('fieldset');
  if (!row) throw new Error('Missing alert rule row');
  return row;
}

export function minutesField(
  kind: ListedAlertKind,
  timing: 'delay' | 'lead',
  locale: Locale = 'en',
): HTMLInputElement {
  const template = timing === 'delay' ? 'alertRules.delayLabel' : 'alertRules.leadLabel';
  const name = alertRulesText(t(locale, template), { kind: alertRuleKindLabel(locale, kind) });
  return screen.getByLabelText(name) as HTMLInputElement;
}
