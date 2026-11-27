import { permissionName, t, type Locale } from '@pospay/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { alertRulesText } from '../model/alert-rules-text';
import {
  alertRulesFixture,
  businessId,
  kindRow,
  kindSwitch,
  mockAlertRulesGet,
  renderPage,
  withAlertRule,
} from './fixtures/alert-rules-page.fixture';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
const locale = vi.hoisted(() => ({ value: 'en' as Locale }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => locale.value }));

const kinds = ['STATEMENT_AWAITING_REVIEW', 'STATEMENT_AWAITING_APPROVAL'] as const;
const fixedTextFor = (lang: Locale, permission: string) =>
  alertRulesText(t(lang, 'alertRules.fixedPermission'), {
    permission: permissionName(lang, permission),
  });

beforeEach(() => {
  locale.value = 'en';
  api.GET.mockReset();
  api.PUT.mockReset();
  api.DELETE.mockReset();
});

it('lists both commission statement rows with English labels and enabled defaults', async () => {
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: alertRulesFixture() })));
  renderPage();
  for (const kind of kinds) {
    const toggle = (await screen.findByRole('switch', {
      name: t('en', `alertRules.kind_${kind}`),
    })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(false);
  }
  expect(screen.getByText('Commission statement awaiting review')).toBeTruthy();
  expect(screen.getByText('Commission statement awaiting approval')).toBeTruthy();
});

it('shows both commission statement rows and fixed permission recipients with Arabic labels', async () => {
  locale.value = 'ar';
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: alertRulesFixture() })));
  renderPage();
  for (const kind of kinds) {
    const toggle = await screen.findByRole('switch', { name: t('ar', `alertRules.kind_${kind}`) });
    expect(t('ar', `alertRules.kind_${kind}`)).not.toBe(t('en', `alertRules.kind_${kind}`));
    expect(toggle).toBe(kindSwitch(kind, 'ar'));
  }
  expect(
    within(kindRow('STATEMENT_AWAITING_REVIEW', 'ar')).getByText(
      fixedTextFor('ar', 'review:commissions:business'),
    ),
  ).toBeTruthy();
  expect(
    within(kindRow('STATEMENT_AWAITING_APPROVAL', 'ar')).getByText(
      fixedTextFor('ar', 'approve:commissions:business'),
    ),
  ).toBeTruthy();
});

it('hides role checkboxes on statement rows and shows the fixed permission recipients instead', async () => {
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: alertRulesFixture() })));
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  for (const kind of kinds) {
    const row = within(kindRow(kind));
    expect(row.queryByRole('group', { name: t('en', 'alertRules.recipientsTitle') })).toBeNull();
    // القنوات بس هي المربعات الباقية: الجرس والإيميل والواتساب.
    expect(row.getAllByRole('checkbox')).toHaveLength(3);
  }
  expect(
    within(kindRow('STATEMENT_AWAITING_REVIEW')).getByText(
      fixedTextFor('en', 'review:commissions:business'),
    ),
  ).toBeTruthy();
  expect(
    within(kindRow('STATEMENT_AWAITING_APPROVAL')).getByText(
      fixedTextFor('en', 'approve:commissions:business'),
    ),
  ).toBeTruthy();
});

it('saves switching a statement kind off and back on', async () => {
  const off = withAlertRule(alertRulesFixture(), 'STATEMENT_AWAITING_APPROVAL', {
    enabled: false,
  });
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: off })));
  api.PUT.mockResolvedValue({ data: alertRulesFixture() });
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  expect(kindSwitch('STATEMENT_AWAITING_APPROVAL').checked).toBe(false);
  fireEvent.click(kindSwitch('STATEMENT_AWAITING_APPROVAL'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect(await screen.findByText(t('en', 'alertRules.saved'))).toBeTruthy();
  expect(api.PUT).toHaveBeenCalledTimes(1);
  const [path, options] = api.PUT.mock.calls[0] ?? [];
  expect(path).toBe('/v1/businesses/{businessId}/alert-rules');
  expect(options.params.path.businessId).toBe(businessId);
  expect(options.body.rules).toHaveLength(1);
  expect(options.body.rules[0]).toMatchObject({
    kind: 'STATEMENT_AWAITING_APPROVAL',
    enabled: true,
  });
  expect(kindSwitch('STATEMENT_AWAITING_APPROVAL').checked).toBe(true);
});
