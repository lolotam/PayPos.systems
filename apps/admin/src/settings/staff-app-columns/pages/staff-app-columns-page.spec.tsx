import { t, type Locale } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  businessId,
  checkbox,
  companyId,
  refusal,
  renderPage,
  settings,
  userId,
} from './fixtures/staff-app-columns-page.fixture';
import { StaffAppColumnsPage } from './staff-app-columns-page';

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

it('shows the stored columns as ticked boxes with an example beside each one', async () => {
  api.GET.mockResolvedValue({ data: settings({ columns: ['date', 'service'], months_back: 3 }) });
  renderPage();
  await screen.findByRole('checkbox', { name: t('en', 'staffAppColumns.label_date') });
  expect(checkbox(t('en', 'staffAppColumns.label_date')).checked).toBe(true);
  expect(checkbox(t('en', 'staffAppColumns.label_service')).checked).toBe(true);
  expect(checkbox(t('en', 'staffAppColumns.label_time')).checked).toBe(false);
  expect(screen.getAllByRole('checkbox')).toHaveLength(10);
  expect(
    screen
      .getAllByRole('checkbox')
      .map((box) => (box as HTMLInputElement).labels?.[0]?.textContent),
  ).toEqual([
    t('en', 'staffAppColumns.label_date'),
    t('en', 'staffAppColumns.label_time'),
    t('en', 'staffAppColumns.label_service'),
    t('en', 'staffAppColumns.label_customer_name'),
    t('en', 'staffAppColumns.label_list_price'),
    t('en', 'staffAppColumns.label_discount'),
    t('en', 'staffAppColumns.label_net'),
    t('en', 'staffAppColumns.label_share'),
    t('en', 'staffAppColumns.label_estimated_commission'),
    t('en', 'staffAppColumns.label_tip'),
  ]);
  expect(screen.getByText(t('en', 'staffAppColumns.example_date'))).toBeTruthy();
  expect(screen.getByText(t('en', 'staffAppColumns.example_share'))).toBeTruthy();
  expect(monthsField().value).toBe('3');
});

it('marks the default while the business never chose', async () => {
  api.GET.mockResolvedValue({ data: settings() });
  renderPage();
  expect((await screen.findAllByText(t('en', 'staffAppColumns.defaultInEffect'))).length).toBe(2);
});

it('drops the default mark once the business chose its own values', async () => {
  api.GET.mockResolvedValue({
    data: settings({ columns_default: false, months_back_default: false }),
  });
  renderPage();
  await screen.findByRole('checkbox', { name: t('en', 'staffAppColumns.label_date') });
  expect(screen.queryByText(t('en', 'staffAppColumns.defaultInEffect'))).toBeNull();
});

it('refuses the screen without a form when the read is forbidden', async () => {
  api.GET.mockResolvedValue(refusal(403));
  renderPage();
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', 'errors.FORBIDDEN'));
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'staffAppColumns.save') })).toBeNull();
});

it('shows the failure of the read and retries it', async () => {
  api.GET.mockResolvedValue({ data: settings() });
  api.GET.mockResolvedValueOnce({
    error: {
      code: 'INTERNAL_ERROR',
      message_ar: 'Synthetic failure',
      message_en: 'Synthetic failure',
    },
    response: { status: 500 },
  });
  renderPage();
  expect((await screen.findByRole('alert')).textContent).toContain('Synthetic failure');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'pos.retry') }));
  await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(2));
  expect(
    await screen.findByRole('checkbox', { name: t('en', 'staffAppColumns.label_date') }),
  ).toBeTruthy();
});

it('saves the change and shows what the server stored', async () => {
  api.GET.mockResolvedValue({ data: settings({ columns: ['date'], months_back: 2 }) });
  api.PUT.mockResolvedValue({
    data: settings({
      columns: ['date', 'net', 'tip'],
      months_back: 5,
      columns_default: false,
      months_back_default: false,
    }),
  });
  renderPage();
  fireEvent.click(
    await screen.findByRole('checkbox', { name: t('en', 'staffAppColumns.label_net') }),
  );
  fireEvent.change(monthsField(), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staffAppColumns.save') }));
  expect(await screen.findByText(t('en', 'staffAppColumns.saved'))).toBeTruthy();
  expect(checkbox(t('en', 'staffAppColumns.label_net')).checked).toBe(true);
  expect(checkbox(t('en', 'staffAppColumns.label_tip')).checked).toBe(true);
  expect(monthsField().value).toBe('5');
  const [path, options] = api.PUT.mock.calls[0] ?? [];
  expect(path).toBe('/v1/businesses/{businessId}/settings/staff-columns');
  expect(options.params.path).toEqual({ businessId });
  expect(options.params.header['x-company-id']).toBe(companyId);
  expect(options.params.header['Idempotency-Key']).toBeTruthy();
  expect(options.body).toEqual({ columns: ['date', 'net'], months_back: 4 });
});

it('keeps an untouched default column set on the default when only the months changed', async () => {
  api.GET.mockResolvedValue({ data: settings({ columns: ['date', 'time', 'service'] }) });
  api.PUT.mockResolvedValue({
    data: settings({
      columns: ['date', 'time', 'service'],
      months_back: 4,
      months_back_default: false,
    }),
  });
  renderPage();
  fireEvent.change(await screen.findByLabelText(t('en', 'staffAppColumns.monthsLabel')), {
    target: { value: '4' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staffAppColumns.save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalled());
  expect(api.PUT.mock.calls[0]?.[1].body).toEqual({ columns: null, months_back: 4 });
  expect(await screen.findByText(t('en', 'staffAppColumns.saved'))).toBeTruthy();
});

it('shows the refusal and keeps the form when the save is forbidden', async () => {
  api.GET.mockResolvedValue({ data: settings() });
  api.PUT.mockResolvedValue(refusal(403));
  renderPage();
  await screen.findByRole('checkbox', { name: t('en', 'staffAppColumns.label_date') });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staffAppColumns.save') }));
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', 'errors.FORBIDDEN'));
  expect(
    screen.getByRole('checkbox', { name: t('en', 'staffAppColumns.label_date') }),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'staffAppColumns.save') })).toBeTruthy();
});

it('shows the refusal of the server for the months and keeps the draft', async () => {
  api.GET.mockResolvedValue({ data: settings() });
  api.PUT.mockResolvedValue({
    error: {
      code: 'STAFF_MONTHS_BACK_INVALID',
      message_ar: 'Synthetic months refusal',
      message_en: 'Synthetic months refusal',
    },
    response: { status: 422 },
  });
  renderPage();
  const field = await screen.findByLabelText(t('en', 'staffAppColumns.monthsLabel'));
  fireEvent.change(field, { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staffAppColumns.save') }));
  expect((await screen.findByRole('alert')).textContent).toContain('Synthetic months refusal');
  expect(
    (screen.getByLabelText(t('en', 'staffAppColumns.monthsLabel')) as HTMLInputElement).value,
  ).toBe('20');
});

it('disables the save button while the request is in flight', async () => {
  let release: (value: unknown) => void = () => undefined;
  api.GET.mockResolvedValue({ data: settings() });
  api.PUT.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  renderPage();
  await screen.findByRole('checkbox', { name: t('en', 'staffAppColumns.label_date') });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staffAppColumns.save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalled());
  const button = screen.getByRole('button', { name: t('en', 'staffAppColumns.save') });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(checkbox(t('en', 'staffAppColumns.label_date')).disabled).toBe(true);
  expect(monthsField().disabled).toBe(true);
  release({ data: settings() });
  expect(await screen.findByText(t('en', 'staffAppColumns.saved'))).toBeTruthy();
  expect(checkbox(t('en', 'staffAppColumns.label_date')).disabled).toBe(false);
  expect(monthsField().disabled).toBe(false);
});

it('follows the business when the selection changes', async () => {
  const otherBusiness = '01920000-0000-7000-8000-0000000000a5';
  const otherSettings = {
    business_id: otherBusiness,
    columns: ['tip'],
    columns_default: true,
    months_back: 6,
    months_back_default: true,
  };
  api.GET.mockImplementation(
    (_path: string, options: { params: { path: { businessId: string } } }) =>
      options.params.path.businessId === otherBusiness
        ? { data: otherSettings }
        : { data: settings({ columns: ['date'] }) },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <StaffAppColumnsPage
        key={`${companyId}:${businessId}:${userId}`}
        companyId={companyId}
        userId={userId}
        businessId={businessId}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole('checkbox', { name: t('en', 'staffAppColumns.label_date') });
  expect(checkbox(t('en', 'staffAppColumns.label_date')).checked).toBe(true);
  view.rerender(
    <QueryClientProvider client={client}>
      <StaffAppColumnsPage
        key={`${companyId}:${otherBusiness}:${userId}`}
        companyId={companyId}
        userId={userId}
        businessId={otherBusiness}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(checkbox(t('en', 'staffAppColumns.label_tip')).checked).toBe(true));
  expect(checkbox(t('en', 'staffAppColumns.label_date')).checked).toBe(false);
  expect(monthsField().value).toBe('6');
  api.PUT.mockResolvedValue({ data: otherSettings });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staffAppColumns.save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalled());
  expect(api.PUT.mock.calls[0]?.[1].params.path).toEqual({ businessId: otherBusiness });
});

it('shows the Arabic screen with the Arabic column names', async () => {
  locale.value = 'ar';
  api.GET.mockResolvedValue({ data: settings() });
  renderPage();
  expect(await screen.findByText(t('ar', 'staffAppColumns.title'))).toBeTruthy();
  expect(
    await screen.findByRole('checkbox', { name: t('ar', 'staffAppColumns.label_date') }),
  ).toBeTruthy();
});
