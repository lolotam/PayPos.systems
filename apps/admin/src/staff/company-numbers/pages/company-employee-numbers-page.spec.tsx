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
  expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual(['Heba', 'Noura']);
  const hebaRow = rows[0];
  const nouraRow = rows[1];
  if (!hebaRow || !nouraRow) throw new Error('missing server row');
  expect(within(hebaRow).getByText('\u2014')).toBeTruthy();
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

it('shows the saved number from the cache while the list refetch is still pending', async () => {
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
  expect(noura.employee_number).toBe(4);
  expect(reads()).toBeGreaterThan(1);
  expect(screen.getByRole('textbox')).toBeTruthy();
});

it('does not send an invalid number', async () => {
  renderPage();
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '007a' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toContain(t('en', 'companyEmployeeNumbers.invalid'));
  });
  expect(api.PUT).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '12' } });
  expect(screen.queryByText(t('en', 'companyEmployeeNumbers.invalid'))).toBeNull();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toContain(t('en', 'companyEmployeeNumbers.invalid'));
  });
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

it('invalidates the staff list for this company after the number is saved', async () => {
  api.PUT.mockResolvedValue({ data: { employee_id: nouraId, employee_number: 7 } });
  const { client } = renderPage();
  const staffKey = ['employees', companyId, salonId, userId] as const;
  client.setQueryData(staffKey, { items: [] });
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  await waitFor(() => expect(client.getQueryState(staffKey)?.isInvalidated).toBe(true));
});

it('focuses the number input when the editor opens', async () => {
  renderPage();
  await openNoura('en');
  expect(screen.getByRole('textbox')).toBe(document.activeElement);
});

it('sends the shown number when the field is not retyped', async () => {
  api.PUT.mockResolvedValue({ data: { employee_id: nouraId, employee_number: 4 } });
  renderPage();
  await openNoura('en');
  const box = screen.getByRole('textbox');
  expect((box as HTMLInputElement).value).toBe('4');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(1));
  const [, options] = api.PUT.mock.calls[0] ?? [];
  expect(options.body).toEqual({ employee_number: 4 });
});

it('opens a blank field when the employee has no number', async () => {
  renderPage();
  const row = await screen.findByRole('row', { name: /Heba/ });
  fireEvent.click(within(row).getByRole('button', { name: editName('en', 'Heba') }));
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
});

it('returns focus to that row edit button when the editor closes', async () => {
  renderPage();
  await openNoura('en');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.close') }));
  const edit = within(screen.getByRole('row', { name: /Noura/ })).getByRole('button', {
    name: editName('en', 'Noura'),
  });
  expect(edit).toBe(document.activeElement);
});

it('closes the editor on escape and returns focus to that row edit button', async () => {
  renderPage();
  await openNoura('en');
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  const edit = within(screen.getByRole('row', { name: /Noura/ })).getByRole('button', {
    name: editName('en', 'Noura'),
  });
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(edit).toBe(document.activeElement);
});

it('focuses the earlier row input and returns to its edit button on escape', async () => {
  renderPage();
  await screen.findByText('Heba');
  fireEvent.click(screen.getByRole('button', { name: editName('en', 'Noura') }));
  fireEvent.click(screen.getByRole('button', { name: editName('en', 'Heba') }));
  const row = screen.getByRole('row', { name: /Heba/ });
  expect(within(row).getByRole('textbox')).toBe(document.activeElement);
  fireEvent.keyDown(within(row).getByRole('textbox'), { key: 'Escape' });
  expect(within(row).getByRole('button', { name: editName('en', 'Heba') })).toBe(document.activeElement);
});

it('returns focus to that row edit button after the number is saved', async () => {
  api.PUT.mockResolvedValue({ data: { employee_id: nouraId, employee_number: 6 } });
  renderPage();
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '6' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  const edit = await within(await screen.findByRole('row', { name: /Noura/ })).findByRole('button', {
    name: editName('en', 'Noura'),
  });
  expect(edit).toBe(document.activeElement);
});

it('disables every edit button while a save is pending', async () => {
  api.PUT.mockImplementation(() => new Promise(() => undefined));
  renderPage();
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '6' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(1));
  const prefix = t('en', 'companyEmployeeNumbers.editName').replace('{name}', '');
  const edits = screen.getAllByRole('button').filter((button) =>
    (button.getAttribute('aria-label') ?? '').startsWith(prefix),
  );
  expect(edits.length).toBeGreaterThan(0);
  expect(edits.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  for (const button of edits) (button as HTMLButtonElement).click();
  expect(api.PUT).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
});

it('closes the open editor when the search settles', async () => {
  renderPage();
  await openNoura('en');
  fireEvent.change(screen.getByRole('searchbox', { name: t('en', 'staff.search') }), {
    target: { value: '  2  ' },
  });
  await waitFor(() => {
    expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({ limit: 20, q: '2' });
  });
  await within(await screen.findByRole('row', { name: /Noura/ })).findByRole('button', {
    name: editName('en', 'Noura'),
  });
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('shows the retry envelope instead of the taken message', async () => {
  api.PUT.mockResolvedValue({
    error: {
      code: 'TRANSACTION_RETRY_REQUIRED',
      message_en: 'Synthetic retry',
      message_ar: 'Synthetic retry ar',
    },
    response: { status: 409 },
  });
  renderPage();
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  expect((await screen.findByRole('alert')).textContent).toContain('Synthetic retry');
  expect(screen.queryByText(t('en', 'errors.EMPLOYEE_NUMBER_TAKEN'))).toBeNull();
  expect(within(screen.getByRole('row', { name: /Noura/ })).getByText('4')).toBeTruthy();
});

it('shows the feature envelope instead of no access', async () => {
  api.GET.mockResolvedValue({
    error: {
      code: 'FEATURE_DISABLED',
      message_en: 'Synthetic feature',
      message_ar: 'Synthetic feature ar',
    },
    response: { status: 403 },
  });
  renderPage();
  expect((await screen.findByRole('alert')).textContent).toContain('Synthetic feature');
  expect(screen.queryByText(t('en', 'companyEmployeeNumbers.noAccess'))).toBeNull();
  expect(screen.getByRole('searchbox', { name: t('en', 'staff.search') })).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
});

it('keeps the editor and its failure when paging and search are tried during a save', async () => {
  let finish: (value: unknown) => void = () => undefined;
  api.PUT.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  renderPage();
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(1));
  const next = screen.getByRole('button', { name: t('en', 'staff.next') });
  const first = screen.getByRole('button', { name: t('en', 'staff.first') });
  const search = screen.getByRole('searchbox', { name: t('en', 'staff.search') });
  expect([next, first, search].every((node) => (node as HTMLInputElement).disabled)).toBe(true);
  fireEvent.click(next);
  fireEvent.click(first);
  fireEvent.change(search, { target: { value: '2' } });
  expect(within(screen.getByRole('row', { name: /Noura/ })).getByRole('textbox')).toBeTruthy();
  expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({ limit: 20 });
  finish({
    error: { code: 'EMPLOYEE_NUMBER_TAKEN', message_en: 'Synthetic taken', message_ar: 'Synthetic taken ar' },
    response: { status: 409 },
  });
  const row = screen.getByRole('row', { name: /Noura/ });
  expect((await within(row).findByRole('alert')).textContent).toContain(t('en', 'errors.EMPLOYEE_NUMBER_TAKEN'));
});

it('keeps a pending failure on the row that submitted it', async () => {
  let finish: (value: unknown) => void = () => undefined;
  api.PUT.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  renderPage();
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: editName('en', 'Heba') }));
  expect(within(screen.getByRole('row', { name: /Noura/ })).getByRole('textbox')).toBeTruthy();
  finish({
    error: {
      code: 'EMPLOYEE_NUMBER_TAKEN',
      message_en: 'Synthetic taken',
      message_ar: 'Synthetic taken ar',
    },
    response: { status: 409 },
  });
  const row = screen.getByRole('row', { name: /Noura/ });
  expect((await within(row).findByRole('alert')).textContent).toContain(t('en', 'errors.EMPLOYEE_NUMBER_TAKEN'));
  expect(within(screen.getByRole('row', { name: /Heba/ })).queryByRole('alert')).toBeNull();
  expect(within(row).getByText('4')).toBeTruthy();
});

it('keeps a pending success on the row that submitted it', async () => {
  hangAfterFirstPage(api.GET);
  let finish: (value: unknown) => void = () => undefined;
  api.PUT.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  renderPage();
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '6' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: editName('en', 'Heba') }));
  finish({ data: { employee_id: nouraId, employee_number: 6 } });
  const row = screen.getByRole('row', { name: /Noura/ });
  await waitFor(() => expect(within(row).getByText('6')).toBeTruthy());
  expect(within(row).getByRole('textbox')).toBeTruthy();
  expect(within(screen.getByRole('row', { name: /Heba/ })).queryByRole('textbox')).toBeNull();
  expect(api.PUT).toHaveBeenCalledTimes(1);
});

it('closes the open editor when the page changes', async () => {
  renderPage();
  await openNoura('en');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.next') }));
  await screen.findByRole('button', { name: t('en', 'staff.first') });
  expect(
    within(screen.getByRole('row', { name: /Noura/ })).getByRole('button', {
      name: editName('en', 'Noura'),
    }),
  ).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
});
