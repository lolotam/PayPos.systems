import { t, type Locale } from '@pospay/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  clinicId,
  companyId,
  editName,
  hangAfterFirstPage,
  listedPage,
  nextCursor,
  noura,
  nouraId,
  openNoura,
  renderPage,
  salonId,
  userId,
} from './fixtures/company-employee-numbers-page.fixture';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
const locale = vi.hoisted(() => ({ value: 'en' as Locale }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => locale.value }));

beforeEach(() => {
  locale.value = 'en';
  noura.employee_number = 4;
  api.GET.mockReset().mockImplementation(() => Promise.resolve({ data: listedPage() }));
  api.PUT.mockReset();
});

it('renders only the rows the server returns', async () => {
  renderPage();
  await screen.findByText('Noura');
  expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
    t('en', 'companyEmployeeNumbers.name'),
    t('en', 'companyEmployeeNumbers.business'),
    t('en', 'companyEmployeeNumbers.number'),
  ]);
  const rows = screen.getAllByRole('row').slice(1);
  expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
    'Heba',
    'Noura',
  ]);
  const hebaRow = rows[0];
  const nouraRow = rows[1];
  if (!hebaRow || !nouraRow) throw new Error('missing server row');
  expect(within(hebaRow).getByText('8')).toBeTruthy();
  expect(within(nouraRow).getByText('Synthetic clinic')).toBeTruthy();
  expect(within(nouraRow).getByText('4')).toBeTruthy();
  expect(screen.queryByText('synthetic-salary')).toBeNull();
  expect(screen.queryByText('synthetic-phone')).toBeNull();
  expect(api.GET.mock.calls.length).toBeGreaterThan(0);
  expect(api.GET.mock.calls.every((call) => call[0] === '/v1/employee-numbers')).toBe(true);
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

it('names each edit button with the employee name', async () => {
  renderPage();
  await screen.findByText('Noura');
  expect(screen.getByRole('button', { name: editName('en', 'Heba') })).toBeTruthy();
  expect(screen.getByRole('button', { name: editName('en', 'Noura') })).toBeTruthy();
});

it('closes the editor after a save while the list refetch hangs', async () => {
  const reads = hangAfterFirstPage(api.GET);
  api.PUT.mockResolvedValue({ data: { employee_id: nouraId, employee_number: 7 } });
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
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(
    (screen.getByRole('button', { name: editName('en', 'Noura') }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(
    (screen.getByRole('button', { name: editName('en', 'Heba') }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(
    (screen.getByRole('searchbox', { name: t('en', 'staff.search') }) as HTMLInputElement).disabled,
  ).toBe(false);
  expect(
    (screen.getByRole('button', { name: t('en', 'staff.next') }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(noura.employee_number).toBe(4);
  expect(reads()).toBeGreaterThan(1);
});

it('does not send an invalid number', async () => {
  renderPage();
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '007a' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toContain(
      t('en', 'companyEmployeeNumbers.invalid'),
    );
  });
  expect(api.PUT).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '12' } });
  expect(screen.queryByText(t('en', 'companyEmployeeNumbers.invalid'))).toBeNull();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toContain(
      t('en', 'companyEmployeeNumbers.invalid'),
    );
  });
  expect(api.PUT).not.toHaveBeenCalled();
  expect(within(screen.getByRole('row', { name: /Noura/ })).getByText('4')).toBeTruthy();
});

it('describes the number field with the validation message only while it shows', async () => {
  renderPage();
  await openNoura('en');
  const field = screen.getByRole('textbox');
  fireEvent.change(field, { target: { value: '007a' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  const alert = await screen.findByRole('alert');
  expect(field.getAttribute('aria-describedby')).toBe(alert.id);
  fireEvent.change(field, { target: { value: '12' } });
  expect(field.getAttribute('aria-describedby')).toBeNull();
});

it.each(['en', 'ar'] as const)(
  'keeps the old number and shows the taken message in %s',
  async (lang) => {
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
    expect((await screen.findByRole('alert')).textContent).toContain(
      t(lang, 'errors.EMPLOYEE_NUMBER_TAKEN'),
    );
    expect(within(screen.getByRole('row', { name: /Noura/ })).getByText('4')).toBeTruthy();
  },
);

it('hides the taken message once the number is edited and shows it again on the next refusal', async () => {
  locale.value = 'en';
  api.PUT.mockResolvedValue({
    error: {
      code: 'EMPLOYEE_NUMBER_TAKEN',
      message_en: 'Synthetic taken',
      message_ar: 'Synthetic taken ar',
    },
    response: { status: 409 },
  });
  renderPage();
  await openNoura('en');
  const field = screen.getByRole('textbox');
  fireEvent.change(field, { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    t('en', 'errors.EMPLOYEE_NUMBER_TAKEN'),
  );
  fireEvent.change(field, { target: { value: '10' } });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    t('en', 'errors.EMPLOYEE_NUMBER_TAKEN'),
  );
});

it('shows the refusal and keeps the old number when the save is forbidden', async () => {
  api.PUT.mockResolvedValue({
    error: {
      code: 'FORBIDDEN',
      message_en: 'Synthetic refusal',
      message_ar: 'Synthetic refusal ar',
    },
    response: { status: 403 },
  });
  renderPage();
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    t('en', 'companyEmployeeNumbers.refusal'),
  );
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
    error: {
      code: 'FORBIDDEN',
      message_en: 'Synthetic refusal',
      message_ar: 'Synthetic refusal ar',
    },
    response: { status: 403 },
  });
  renderPage();
  expect((await screen.findByRole('alert')).textContent).toContain(
    t(lang, 'companyEmployeeNumbers.noAccess'),
  );
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

it('drops the cached staff list for this company after the number is saved', async () => {
  api.PUT.mockResolvedValue({ data: { employee_id: nouraId, employee_number: 7 } });
  const { client } = renderPage();
  const staffKey = ['employees', companyId, salonId, userId] as const;
  client.setQueryData(staffKey, { items: [] });
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  await waitFor(() => expect(client.getQueryState(staffKey)).toBeUndefined());
});
