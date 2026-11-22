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

beforeEach(() => {
  locale.value = 'en';
  api.GET.mockReset();
  api.PUT.mockReset();
  api.DELETE.mockReset();
});

it('shows the low-rating row with its English label and an editable default switch', async () => {
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: alertRulesFixture() })));
  renderPage();
  const toggle = (await screen.findByRole('switch', {
    name: 'Low customer rating',
  })) as HTMLInputElement;
  expect(toggle.checked).toBe(true);
  expect(toggle.disabled).toBe(false);
  const roles = within(kindRow('LOW_RATING')).getAllByRole('checkbox') as HTMLInputElement[];
  expect(roles.map((role) => role.checked)).toEqual([true, true, true, true]);
});

it('shows the low-rating row with its Arabic label', async () => {
  locale.value = 'ar';
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: alertRulesFixture() })));
  renderPage();
  const toggle = await screen.findByRole('switch', {
    name: t('ar', 'alertRules.kind_LOW_RATING'),
  });
  expect(t('ar', 'alertRules.kind_LOW_RATING')).not.toBe(t('en', 'alertRules.kind_LOW_RATING'));
  expect(toggle).toBe(kindSwitch('LOW_RATING', 'ar'));
});

it('shows the switch off when the saved rule is off, and saves the new state', async () => {
  const off = withAlertRule(alertRulesFixture(), 'LOW_RATING', { enabled: false });
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: off })));
  api.PUT.mockResolvedValue({ data: alertRulesFixture() });
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  expect(kindSwitch('LOW_RATING').checked).toBe(false);
  fireEvent.click(kindSwitch('LOW_RATING'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect(await screen.findByText(t('en', 'alertRules.saved'))).toBeTruthy();
  expect(kindSwitch('LOW_RATING').checked).toBe(true);
});
