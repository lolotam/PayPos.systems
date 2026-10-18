import { t, type Locale } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CompanyEmployeeNumbersPage } from './company-employee-numbers-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
const locale = vi.hoisted(() => ({ value: 'en' as Locale }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => locale.value }));

const companyId = '01920000-0000-7000-8000-0000000000a1';
const userId = '01920000-0000-7000-8000-0000000000a2';
const salonId = '01920000-0000-7000-8000-0000000000b1';
const clinicId = '01920000-0000-7000-8000-0000000000b2';
const hebaId = '01920000-0000-7000-8000-0000000000c1';
const nouraId = '01920000-0000-7000-8000-0000000000c2';
const nextCursor = '01920000-0000-7000-8000-0000000000d1';
const deniedName = 'Synthetic denied employee';
const heba = {
  employee_id: hebaId,
  name_ar: null,
  name_en: 'Heba',
  business_id: salonId,
  business_name_ar: null,
  business_name_en: 'Synthetic salon',
  employee_number: null as number | null,
  salary_mills: 'synthetic-salary',
  phone: 'synthetic-phone',
};
const noura = {
  employee_id: nouraId,
  name_ar: null,
  name_en: 'Noura',
  business_id: clinicId,
  business_name_ar: null,
  business_name_en: 'Synthetic clinic',
  employee_number: 4 as number | null,
};

function listedPage() {
  return { items: [{ ...heba }, { ...noura }], next_cursor: nextCursor };
}

beforeEach(() => {
  locale.value = 'en';
  noura.employee_number = 4;
  api.GET.mockReset().mockImplementation(() => Promise.resolve({ data: listedPage() }));
  api.PUT.mockReset();
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CompanyEmployeeNumbersPage companyId={companyId} userId={userId} />
    </QueryClientProvider>,
  );
}

async function openNoura(lang: Locale) {
  const row = await screen.findByRole('row', { name: /Noura/ });
  fireEvent.click(within(row).getByRole('button', { name: t(lang, 'companyEmployeeNumbers.edit') }));
}

it('shows only name, business and number, including another business, and hides a denied employee', async () => {
  renderPage();
  await screen.findByText('Noura');
  expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
    t('en', 'companyEmployeeNumbers.name'),
    t('en', 'companyEmployeeNumbers.business'),
    t('en', 'companyEmployeeNumbers.number'),
  ]);
  expect(within(screen.getByRole('row', { name: /Heba/ })).getByText('\u2014')).toBeTruthy();
  const other = screen.getByRole('row', { name: /Noura/ });
  expect(within(other).getByText('Synthetic clinic')).toBeTruthy();
  expect(within(other).getByText('4')).toBeTruthy();
  expect(within(other).getByRole('button', { name: t('en', 'companyEmployeeNumbers.edit') })).toBeTruthy();
  expect(screen.queryByText(deniedName)).toBeNull();
  expect(screen.queryByText('synthetic-salary')).toBeNull();
  expect(screen.queryByText('synthetic-phone')).toBeNull();
  expect(api.GET).toHaveBeenCalledWith(
    '/v1/employee-numbers',
    expect.objectContaining({
      params: expect.objectContaining({
        header: { 'x-company-id': companyId },
        query: { limit: 20 },
      }),
    }),
  );
});

it('sends 007 as 7 for that business and employee and shows the saved number', async () => {
  api.PUT.mockImplementation(() => {
    noura.employee_number = 7;
    return Promise.resolve({ data: { employee_id: nouraId, employee_number: 7 } });
  });
  renderPage();
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '007' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalled());
  const [path, options] = api.PUT.mock.calls[0] ?? [];
  expect(path).toBe('/v1/businesses/{businessId}/employees/{employeeId}/employee-number');
  expect(options.params.path).toEqual({ businessId: clinicId, employeeId: nouraId });
  expect(options.params.header).toEqual({ 'x-company-id': companyId });
  expect(options.body).toEqual({ employee_number: 7 });
  const row = screen.getByRole('row', { name: /Noura/ });
  await waitFor(() => expect(within(row).getByText('7')).toBeTruthy());
  expect(within(row).queryByText('4')).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'companyEmployeeNumbers.save') })).toBeNull();
});

it('does not send an invalid number', async () => {
  renderPage();
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '007a' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  expect(screen.getByRole('alert').textContent).toContain(t('en', 'companyEmployeeNumbers.invalid'));
  expect(api.PUT).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  expect(api.PUT).not.toHaveBeenCalled();
  expect(within(screen.getByRole('row', { name: /Noura/ })).getByText('4')).toBeTruthy();
});

it.each(['en', 'ar'] as const)('keeps the old number and shows the taken message in %s', async (lang) => {
  locale.value = lang;
  api.PUT.mockResolvedValue({
    error: {
      code: 'EMPLOYEE_NUMBER_TAKEN',
      message_en: 'Synthetic taken',
      message_ar: 'Synthetic taken ar',
    },
    response: { status: 409 },
  });
  renderPage();
  await openNoura(lang);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: t(lang, 'companyEmployeeNumbers.save') }));
  expect((await screen.findByRole('alert')).textContent).toContain(t(lang, 'errors.EMPLOYEE_NUMBER_TAKEN'));
  expect(within(screen.getByRole('row', { name: /Noura/ })).getByText('4')).toBeTruthy();
});

it('shows the refusal and keeps the old number when the save is forbidden', async () => {
  api.PUT.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_en: 'Synthetic refusal', message_ar: 'Synthetic refusal ar' },
    response: { status: 403 },
  });
  renderPage();
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', 'companyEmployeeNumbers.refusal'));
  expect(within(screen.getByRole('row', { name: /Noura/ })).getByText('4')).toBeTruthy();
});

it('sends the trimmed search as q and clears q when the box is emptied', async () => {
  renderPage();
  await screen.findByText('Noura');
  const box = screen.getByRole('searchbox', { name: t('en', 'staff.search') });
  fireEvent.change(box, { target: { value: '  2  ' } });
  await waitFor(() => {
    expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({ limit: 20, q: '2' });
  });
  fireEvent.change(box, { target: { value: '   ' } });
  await waitFor(() => {
    expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({ limit: 20 });
  });
});

it.each(['en', 'ar'] as const)('shows no access in %s when the list is forbidden', async (lang) => {
  locale.value = lang;
  api.GET.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_en: 'Synthetic refusal', message_ar: 'Synthetic refusal ar' },
    response: { status: 403 },
  });
  renderPage();
  expect((await screen.findByRole('alert')).textContent).toContain(t(lang, 'companyEmployeeNumbers.noAccess'));
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('searchbox')).toBeNull();
});

it('requests the next cursor and returns to the first page', async () => {
  renderPage();
  await screen.findByText('Noura');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.next') }));
  await waitFor(() => {
    expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({ limit: 20, cursor: nextCursor });
  });
  const first = await screen.findByRole('button', { name: t('en', 'staff.first') });
  fireEvent.click(first);
  await waitFor(() => {
    expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({ limit: 20 });
  });
});
