import { t } from '@pospay/i18n';
import { screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  alertRulesFixture,
  branchA,
  kindRow,
  kindSwitch,
  mockAlertRulesGet,
  refusal,
  renderPage,
} from './fixtures/alert-rules-page.fixture';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  api.DELETE.mockReset();
});

it('lays the rules on the form shell with one header and the scope selector above them', async () => {
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: alertRulesFixture() })));
  renderPage({ branches: [branchA] });
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  const heading = screen.getByRole('heading', { name: t('en', 'alertRules.title') });
  const shell = heading.closest('[data-page-shell="form"]');
  expect(shell).not.toBeNull();
  expect(screen.getAllByRole('heading', { name: t('en', 'alertRules.title') })).toHaveLength(1);
  const scope = screen.getByLabelText(t('en', 'alertRules.scopeLabel'));
  const rule = kindRow('SHIFT_NOT_CLOCKED_IN');
  expect(shell?.contains(scope)).toBe(true);
  expect(
    scope.compareDocumentPosition(rule) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(within(rule).getByRole('switch')).toBe(kindSwitch('SHIFT_NOT_CLOCKED_IN'));
});

it('keeps the rules inside the same shell when the alert rules read is refused', async () => {
  api.GET.mockImplementation(mockAlertRulesGet(() => refusal(403)));
  renderPage({ branches: [branchA] });
  const alert = await screen.findByRole('alert');
  expect(alert.closest('[data-page-shell="form"]')).not.toBeNull();
  expect(screen.getByRole('heading', { name: t('en', 'alertRules.title') })).toBeTruthy();
});
