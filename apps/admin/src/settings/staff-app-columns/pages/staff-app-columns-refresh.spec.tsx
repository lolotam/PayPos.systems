import { t, type Locale } from '@pospay/i18n';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { staffColumnsKey } from '@/settings/staff-app-columns/api/staff-columns-client';
import {
  businessId,
  checkbox,
  companyId,
  renderPage,
  settings,
  userId,
} from './fixtures/staff-app-columns-page.fixture';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
const locale = vi.hoisted(() => ({ value: 'en' as Locale }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => locale.value }));

function monthsField(): HTMLInputElement {
  return screen.getByLabelText(t(locale.value, 'staffAppColumns.monthsLabel')) as HTMLInputElement;
}

beforeEach(() => {
  locale.value = 'en';
  api.GET.mockReset();
  api.PUT.mockReset();
});

it('follows the server when the setting is refreshed', async () => {
  api.GET.mockResolvedValue({ data: settings({ columns: ['date'], months_back: 2 }) });
  const { client } = renderPage();
  await screen.findByRole('checkbox', { name: t('en', 'staffAppColumns.label_date') });
  await act(async () => {
    client.setQueryData(
      staffColumnsKey(companyId, userId, businessId),
      settings({ columns: ['date', 'tip'], months_back: 7 }),
    );
  });
  await waitFor(() => expect(checkbox(t('en', 'staffAppColumns.label_tip')).checked).toBe(true));
  expect(monthsField().value).toBe('7');
});

it('keeps the edited field when the setting is refreshed', async () => {
  api.GET.mockResolvedValue({ data: settings({ columns: ['date'], months_back: 2 }) });
  const { client } = renderPage();
  await screen.findByRole('checkbox', { name: t('en', 'staffAppColumns.label_date') });
  await act(async () => {
    fireEvent.change(monthsField(), { target: { value: '4' } });
  });
  await act(async () => {
    client.setQueryData(
      staffColumnsKey(companyId, userId, businessId),
      settings({ columns: ['date', 'tip'], months_back: 7 }),
    );
  });
  await waitFor(() => expect(checkbox(t('en', 'staffAppColumns.label_tip')).checked).toBe(true));
  expect(monthsField().value).toBe('4');
});

it('keeps the form and shows the failure when a background refresh fails', async () => {
  api.GET.mockResolvedValue({ data: settings() });
  const { client } = renderPage();
  await screen.findByRole('checkbox', { name: t('en', 'staffAppColumns.label_date') });
  fireEvent.click(screen.getByRole('checkbox', { name: t('en', 'staffAppColumns.label_net') }));
  api.GET.mockResolvedValue({
    error: {
      code: 'INTERNAL_ERROR',
      message_ar: 'Synthetic failure',
      message_en: 'Synthetic failure',
    },
    response: { status: 500 },
  });
  await act(async () => {
    await client.invalidateQueries({ queryKey: staffColumnsKey(companyId, userId, businessId) });
  });
  expect((await screen.findByRole('alert')).textContent).toContain('Synthetic failure');
  expect(screen.getByRole('button', { name: t('en', 'pos.retry') })).toBeTruthy();
  expect(checkbox(t('en', 'staffAppColumns.label_net')).checked).toBe(true);
});

it('reuses the same idempotency key when the response is lost', async () => {
  api.GET.mockResolvedValue({ data: settings({ columns: ['date'], months_back: 2 }) });
  api.PUT.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({
    data: settings({ columns: ['date'], months_back: 2 }),
  });
  renderPage();
  await screen.findByRole('checkbox', { name: t('en', 'staffAppColumns.label_date') });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staffAppColumns.save') }));
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', 'admin.unexpected'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staffAppColumns.save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(2));
  const first = api.PUT.mock.calls[0]?.[1].params.header['Idempotency-Key'];
  const second = api.PUT.mock.calls[1]?.[1].params.header['Idempotency-Key'];
  expect(second).toBe(first);
  expect(await screen.findByText(t('en', 'staffAppColumns.saved'))).toBeTruthy();
});

it('mints a new idempotency key after a successful save', async () => {
  api.GET.mockResolvedValue({ data: settings({ columns: ['date'], months_back: 2 }) });
  api.PUT.mockResolvedValue({ data: settings({ columns: ['date'], months_back: 2 }) });
  renderPage();
  await screen.findByRole('checkbox', { name: t('en', 'staffAppColumns.label_date') });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staffAppColumns.save') }));
  expect(await screen.findByText(t('en', 'staffAppColumns.saved'))).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: t('en', 'staffAppColumns.label_net') }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staffAppColumns.save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(2));
  const first = api.PUT.mock.calls[0]?.[1].params.header['Idempotency-Key'];
  const second = api.PUT.mock.calls[1]?.[1].params.header['Idempotency-Key'];
  expect(second).not.toBe(first);
});

it('shows only the months message when the months field is empty', async () => {
  api.GET.mockResolvedValue({ data: settings() });
  renderPage();
  const field = await screen.findByLabelText(t('en', 'staffAppColumns.monthsLabel'));
  fireEvent.change(field, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staffAppColumns.save') }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    t('en', 'errors.STAFF_MONTHS_BACK_INVALID'),
  );
  expect(screen.queryByText(t('en', 'errors.STAFF_COLUMNS_INVALID'))).toBeNull();
  expect(api.PUT).not.toHaveBeenCalled();
});
