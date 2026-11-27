import { t } from '@pospay/i18n';
import { screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  alertRulesFixture,
  kindSwitch,
  mockAlertRulesGet,
  renderPage,
} from './fixtures/alert-rules-page.fixture';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

beforeEach(() => {
  api.GET.mockReset();
});

it('renders the known rules when a newer API adds an alert kind this bundle does not know', async () => {
  const known = alertRulesFixture();
  api.GET.mockImplementation(
    mockAlertRulesGet(() =>
      Promise.resolve({
        data: {
          ...known,
          rules: [...known.rules, { ...known.rules[0], kind: 'FUTURE_KIND_FROM_NEWER_API' }],
        },
      }),
    ),
  );

  renderPage();

  expect(
    await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') }),
  ).toBeTruthy();
  expect(kindSwitch('SHIFT_NOT_CLOCKED_IN').checked).toBe(true);
  expect(screen.queryByRole('alert')).toBeNull();
});
