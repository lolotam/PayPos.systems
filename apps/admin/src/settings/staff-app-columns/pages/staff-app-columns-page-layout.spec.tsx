import { t } from '@pospay/i18n';
import { screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderPage, settings } from './fixtures/staff-app-columns-page.fixture';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  api.GET.mockResolvedValue({ data: settings() });
});

it('puts the columns form in one card under the header of the form shell', async () => {
  renderPage();
  await screen.findByRole('checkbox', { name: t('en', 'staffAppColumns.label_date') });
  const heading = screen.getByRole('heading', { name: t('en', 'staffAppColumns.title') });
  const shell = heading.closest('[data-page-shell="form"]');
  expect(shell).not.toBeNull();
  expect(screen.getAllByRole('heading', { name: t('en', 'staffAppColumns.title') })).toHaveLength(1);
  const save = screen.getByRole('button', { name: t('en', 'staffAppColumns.save') });
  const card = save.closest('.rounded-card');
  expect(card).not.toBeNull();
  expect(shell?.contains(card)).toBe(true);
  expect(
    within(card as HTMLElement).getByRole('checkbox', {
      name: t('en', 'staffAppColumns.label_date'),
    }),
  ).toBeTruthy();
  expect(
    within(card as HTMLElement).getByLabelText(t('en', 'staffAppColumns.monthsLabel')),
  ).toBeTruthy();
});
