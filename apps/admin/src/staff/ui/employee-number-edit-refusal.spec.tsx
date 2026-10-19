import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmployeeNumberEdit } from './employee-number-edit';

const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get, PUT: put }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const first = '01920000-0000-7000-8000-0000000000a2';
const second = '01920000-0000-7000-8000-0000000000b2';
const editName = () => t('en', 'staff.editNumber');

function renderEdits() {
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={query}>
      <div data-testid="refused-employee">
        <EmployeeNumberEdit
          companyId={first}
          businessId={first}
          userId={first}
          employeeId={first}
          primaryBranchId={first}
          employeeNumber={15}
        />
      </div>
      <div data-testid="other-employee">
        <EmployeeNumberEdit
          companyId={first}
          businessId={first}
          userId={first}
          employeeId={second}
          primaryBranchId={first}
          employeeNumber={4}
        />
      </div>
    </QueryClientProvider>,
  );
  return query;
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus();
  });
  get.mockResolvedValue({ data: { can_type_number: true } });
  put.mockResolvedValue({
    error: {
      code: 'FORBIDDEN',
      message_en: 'Synthetic refusal',
      message_ar: t('ar', 'errors.FORBIDDEN'),
    },
  });
});

it('hides edit for the refused employee after close and keeps it for another', async () => {
  renderEdits();
  const refused = () => within(screen.getByTestId('refused-employee'));
  const other = () => within(screen.getByTestId('other-employee'));
  fireEvent.click(await refused().findByRole('button', { name: editName() }));
  expect(other().getByRole('button', { name: editName() })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '8' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveNumber') }));
  expect((await screen.findByRole('alert')).textContent).toBe('Synthetic refusal');
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.closeNumber') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(refused().queryByRole('button', { name: editName() })).toBeNull();
  });
  expect(other().getByRole('button', { name: editName() })).toBeTruthy();
});

it('shows edit again when the employee detail attachments change', async () => {
  const query = renderEdits();
  const detailKey = ['employees', first, first, first, 'detail', first] as const;
  query.setQueryData(detailKey, {
    employee_number: 15,
    primary_branch_id: first,
    branch_ids: [first],
  });
  const refused = () => within(screen.getByTestId('refused-employee'));
  fireEvent.click(await refused().findByRole('button', { name: editName() }));
  fireEvent.change(screen.getByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '8' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveNumber') }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.closeNumber') }));
  await waitFor(() => expect(refused().queryByRole('button', { name: editName() })).toBeNull());
  query.setQueryData(detailKey, {
    employee_number: 15,
    primary_branch_id: first,
    branch_ids: [first, second],
  });
  expect(await refused().findByRole('button', { name: editName() })).toBeTruthy();
});
