import { t, type Locale } from '@pospay/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  editName,
  hangAfterFirstPage,
  keepTakenFailureFromEarlySearch,
  listedPage,
  noura,
  nouraId,
  openNoura,
  renderPage,
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
  expect(within(row).getByRole('button', { name: editName('en', 'Heba') })).toBe(
    document.activeElement,
  );
});

it('returns focus to that row edit button after the number is saved', async () => {
  api.PUT.mockResolvedValue({ data: { employee_id: nouraId, employee_number: 6 } });
  renderPage();
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '6' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  const edit = await within(await screen.findByRole('row', { name: /Noura/ })).findByRole(
    'button',
    {
      name: editName('en', 'Noura'),
    },
  );
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
  const edits = screen
    .getAllByRole('button')
    .filter((button) => (button.getAttribute('aria-label') ?? '').startsWith(prefix));
  expect(edits.length).toBeGreaterThan(0);
  expect(edits.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  for (const button of edits) (button as HTMLButtonElement).click();
  expect(api.PUT).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
});

it('keeps search focus when a settled search closes the editor', async () => {
  renderPage();
  await openNoura('en');
  const search = screen.getByRole('searchbox', { name: t('en', 'staff.search') });
  search.focus();
  fireEvent.change(search, { target: { value: '  2  ' } });
  await waitFor(() => {
    expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({ limit: 20, q: '2' });
  });
  await within(await screen.findByRole('row', { name: /Noura/ })).findByRole('button', {
    name: editName('en', 'Noura'),
  });
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(document.activeElement).toBe(search);
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
  api.PUT.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
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
    error: {
      code: 'EMPLOYEE_NUMBER_TAKEN',
      message_en: 'Synthetic taken',
      message_ar: 'Synthetic taken ar',
    },
    response: { status: 409 },
  });
  const row = screen.getByRole('row', { name: /Noura/ });
  expect((await within(row).findByRole('alert')).textContent).toContain(
    t('en', 'errors.EMPLOYEE_NUMBER_TAKEN'),
  );
});

it('keeps a taken failure when a search was typed before the save', async () => {
  await keepTakenFailureFromEarlySearch(api);
});

it('keeps a pending failure on the row that submitted it', async () => {
  let finish: (value: unknown) => void = () => undefined;
  api.PUT.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
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
  expect((await within(row).findByRole('alert')).textContent).toContain(
    t('en', 'errors.EMPLOYEE_NUMBER_TAKEN'),
  );
  expect(within(screen.getByRole('row', { name: /Heba/ })).queryByRole('alert')).toBeNull();
  expect(within(row).getByText('4')).toBeTruthy();
});

it('keeps a pending success on the row that submitted it', async () => {
  hangAfterFirstPage(api.GET);
  let finish: (value: unknown) => void = () => undefined;
  api.PUT.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  renderPage();
  await openNoura('en');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '6' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: editName('en', 'Heba') }));
  finish({ data: { employee_id: nouraId, employee_number: 6 } });
  const row = screen.getByRole('row', { name: /Noura/ });
  await waitFor(() => expect(within(row).getByText('6')).toBeTruthy());
  expect(within(row).queryByRole('textbox')).toBeNull();
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

it('lets the search run again after paging away from a failed save', async () => {
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
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.next') }));
  await screen.findByRole('button', { name: t('en', 'staff.first') });
  fireEvent.change(screen.getByRole('searchbox', { name: t('en', 'staff.search') }), {
    target: { value: 'Noura' },
  });
  await waitFor(() =>
    expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({ limit: 20, q: 'Noura' }),
  );
});

it('a search typed after a failed save runs instead of staying paused', async () => {
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
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'companyEmployeeNumbers.save') }));
  await screen.findByRole('alert');
  fireEvent.change(screen.getByRole('searchbox', { name: t('en', 'staff.search') }), {
    target: { value: 'Noura' },
  });
  await waitFor(() =>
    expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({ limit: 20, q: 'Noura' }),
  );
});
