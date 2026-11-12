import { t, type Locale } from '@pospay/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  alertRulesFixture,
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

const businessPath = '/v1/businesses/{businessId}/alert-rules';
const englishLabel = "Discount approved on the approver's own work";

beforeEach(() => {
  locale.value = 'en';
  api.GET.mockReset();
  api.PUT.mockReset();
  api.DELETE.mockReset();
});

it('shows the editable default rule and saves its visible off state', async () => {
  const initial = alertRulesFixture();
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: initial })));
  api.PUT.mockResolvedValue({
    data: withAlertRule(initial, 'DISCOUNT_SELF_APPROVED', {
      enabled: false,
      source: 'BUSINESS',
      revision: 1,
      rule_id: '01920000-0000-7000-8000-0000000000b1',
    }),
  });
  renderPage();
  const toggle = (await screen.findByRole('switch', { name: englishLabel })) as HTMLInputElement;
  expect(toggle.checked).toBe(true);
  expect(toggle.disabled).toBe(false);
  const roles = within(kindRow('DISCOUNT_SELF_APPROVED')).getAllByRole(
    'checkbox',
  ) as HTMLInputElement[];
  expect(roles.map((role) => role.checked)).toEqual([true, false, false, false]);

  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect(await screen.findByText(t('en', 'alertRules.saved'))).toBeTruthy();
  expect(kindSwitch('DISCOUNT_SELF_APPROVED').checked).toBe(false);
  expect(api.PUT).toHaveBeenCalledWith(
    businessPath,
    expect.objectContaining({
      body: {
        rules: [expect.objectContaining({ kind: 'DISCOUNT_SELF_APPROVED', enabled: false })],
      },
    }),
  );
});

it('shows the Arabic label on the editable row', async () => {
  locale.value = 'ar';
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: alertRulesFixture() })));
  renderPage();
  const toggle = (await screen.findByRole('switch', {
    name: t('ar', 'alertRules.kind_DISCOUNT_SELF_APPROVED'),
  })) as HTMLInputElement;
  expect(toggle.checked).toBe(true);
  expect(toggle.disabled).toBe(false);
});
