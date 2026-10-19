import type { EmployeeNumbering } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmployeeNumberStartDialog } from './employee-number-start-dialog';

const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get, PUT: put }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const id = '01920000-0000-7000-8000-0000000000a2';
const openCounter = {
  next_number: 4,
  start_number: null,
  start_set_at: null,
  can_manage: true,
};
function renderDialog() {
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={query}>
      <EmployeeNumberStartDialog companyId={id} userId={id} />
    </QueryClientProvider>,
  );
  return query;
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus();
  });
});
async function settled(query: QueryClient, status: 'success' | 'error') {
  await waitFor(() => {
    const entry = query.getQueryCache().find({ queryKey: ['employee-numbering', id, id] });
    expect(entry?.state.status).toBe(status);
  });
}

it('opens the start dialog from the button and does not open it alone', async () => {
  get.mockResolvedValue({ data: openCounter });
  const query = renderDialog();
  const opener = await screen.findByRole('button', { name: t('en', 'staff.startNumbering') });
  expect(screen.queryByRole('dialog')).toBeNull();
  await settled(query, 'success');
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole('dialog');
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(screen.getByText(t('en', 'staff.startNumberingLead'))).toBeTruthy();
  expect(screen.getByText('4')).toBeTruthy();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it('hides the start button when numbering is refused', async () => {
  get.mockResolvedValue({
    error: {
      code: 'FORBIDDEN',
      message_en: 'Synthetic refusal',
      message_ar: t('ar', 'errors.FORBIDDEN'),
    },
    response: { status: 403 },
  });
  const query = renderDialog();
  await settled(query, 'error');
  expect(screen.queryByRole('button', { name: t('en', 'staff.startNumbering') })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('hides the start button once a start is already set', async () => {
  get.mockResolvedValue({
    data: {
      ...openCounter,
      can_manage: false,
      start_number: 4,
      start_set_at: '2026-10-18T00:00:00.000Z',
    },
  });
  const query = renderDialog();
  await settled(query, 'success');
  expect(screen.queryByRole('button', { name: t('en', 'staff.startNumbering') })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('hides the start button after 007 is stored as start number 7', async () => {
  let current: EmployeeNumbering = openCounter;
  get.mockImplementation(() => Promise.resolve({ data: current }));
  put.mockImplementation((_path: string, init: { body: { start_number: number } }) => {
    current = {
      next_number: init.body.start_number,
      start_number: init.body.start_number,
      start_set_at: '2026-10-18T00:00:00.000Z',
      can_manage: false,
    };
    return Promise.resolve({ data: current });
  });
  renderDialog();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'staff.startNumbering') }));
  fireEvent.change(await screen.findByLabelText(t('en', 'staff.startNumberField')), {
    target: { value: '007' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveStartNumber') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: t('en', 'staff.startNumbering') })).toBeNull();
  });
  expect(put).toHaveBeenCalledWith(
    '/v1/employee-numbering/start',
    expect.objectContaining({ body: { start_number: 7 } }),
  );
});

it('hides the start button after an already-set refusal refetches', async () => {
  let current: EmployeeNumbering = openCounter;
  get.mockImplementation(() => Promise.resolve({ data: current }));
  put.mockImplementation(() => {
    current = {
      ...openCounter,
      can_manage: false,
      start_number: 4,
      start_set_at: '2026-10-18T00:00:00.000Z',
    };
    return Promise.resolve({
      error: {
        code: 'EMPLOYEE_NUMBER_START_ALREADY_SET',
        message_en: 'Synthetic already set',
        message_ar: t('ar', 'errors.EMPLOYEE_NUMBER_START_ALREADY_SET'),
      },
    });
  });
  const query = renderDialog();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'staff.startNumbering') }));
  fireEvent.change(screen.getByLabelText(t('en', 'staff.startNumberField')), {
    target: { value: '8' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveStartNumber') }));
  await waitFor(() => {
    const entry = query.getQueryCache().find({ queryKey: ['employee-numbering', id, id] });
    expect(entry?.state.data).toMatchObject({ can_manage: false });
  });
  expect(screen.queryByRole('button', { name: t('en', 'staff.startNumbering') })).toBeNull();
});

it('does not save an invalid start number', async () => {
  get.mockResolvedValue({ data: openCounter });
  renderDialog();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'staff.startNumbering') }));
  fireEvent.change(screen.getByLabelText(t('en', 'staff.startNumberField')), {
    target: { value: '12a' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveStartNumber') }));
  expect((await screen.findByRole('alert')).textContent).toBe(t('en', 'staff.numberInvalid'));
  expect(put).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeTruthy();
});
