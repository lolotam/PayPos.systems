import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useEmployees } from '../api/use-employees';
import { useCompanyEmployeeNumbers } from '../company-numbers/api/use-company-employee-numbers';
import { EmployeeEditPanel } from './employee-edit-panel';
import { EmployeeListPanel } from './employee-list-panel';

const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  number: 15 as number | null,
  canType: true,
  refuse: null as { code: string; message_en: string; message_ar: string } | null,
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get, PUT: put }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('../api/use-employee-name-matches', () => ({
  useEmployeeNameMatches: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./employee-record-sections', () => ({ EmployeeRecordSections: () => null }));
vi.mock('./employee-leave-section', () => ({ EmployeeLeaveSection: () => null }));

const id = '01920000-0000-7000-8000-0000000000a2';
const business = {
  id,
  name_en: 'Synthetic salon',
  name_ar: null,
  vertical_type: 'salon' as const,
  timezone: 'Asia/Kuwait',
  branches: [
    {
      id,
      name_ar: null,
      name_en: 'Synthetic primary',
      effective_timezone: 'Asia/Kuwait',
      is_active: true,
    },
  ],
};
function detail() {
  return {
    id,
    business_id: id,
    primary_branch_id: id,
    name_en: 'Synthetic employee',
    name_ar: null,
    role_code: 'staff' as const,
    hire_date: '2026-01-01',
    contract_end: null,
    user_id: null,
    created_at: '2026-10-03T00:00:00.000Z',
    employee_number: state.number,
    revision: 3,
    branch_ids: [id],
  };
}
function listItem() {
  return {
    id,
    name_en: 'Synthetic employee',
    name_ar: null,
    role_code: 'staff' as const,
    primary_branch_id: id,
    hire_date: '2026-01-01',
    employee_number: state.number,
  };
}
function ProfileAndList() {
  const list = useEmployees(id, id, id);
  return (
    <>
      <EmployeeListPanel
        list={list}
        branches={business.branches}
        selectedId=""
        cursor={undefined}
        search=""
        onSearch={() => undefined}
        onSelect={() => undefined}
        onPage={() => undefined}
      />
      <EmployeeEditPanel
        companyId={id}
        business={business}
        userId={id}
        employeeId={id}
        onClose={() => undefined}
      />
    </>
  );
}
function CompanyNumbersProbe() {
  useCompanyEmployeeNumbers(id, id);
  return null;
}
function renderProfile(extra?: ReactNode) {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={query}>
      <ProfileAndList />
      {extra}
    </QueryClientProvider>,
  );
  return query;
}
function installDialog() {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus();
  });
}
beforeEach(() => {
  installDialog();
  state.number = 15;
  state.canType = true;
  state.refuse = null;
  get.mockImplementation((path: string) => {
    if (path === '/v1/businesses/{businessId}/employee-number-capability') {
      return Promise.resolve({ data: { can_type_number: state.canType } });
    }
    if (path === '/v1/businesses/{businessId}/employees/{employeeId}')
      return Promise.resolve({ data: detail() });
    if (path === '/v1/businesses/{businessId}/employees') {
      return Promise.resolve({ data: { items: [listItem()], next_cursor: null } });
    }
    return Promise.resolve({
      error: { message_en: 'Synthetic missing', message_ar: 'Synthetic missing' },
      response: { status: 404 },
    });
  });
  put.mockImplementation((_path: string, init: { body: { employee_number: number } }) => {
    if (state.refuse) return Promise.resolve({ error: state.refuse });
    state.number = init.body.employee_number;
    return Promise.resolve({ data: { employee_id: id, employee_number: state.number } });
  });
});

it('shows the saved number on the profile and the list', async () => {
  renderProfile();
  expect(await screen.findByRole('cell', { name: '15' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'staff.editNumber') }));
  fireEvent.change(screen.getByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '007' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveNumber') }));
  expect(await screen.findByRole('cell', { name: '7' })).toBeTruthy();
  expect(
    screen.getByRole('heading', { name: t('en', 'staff.editTitle') }).parentElement?.textContent,
  ).toContain('7');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(put).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/employees/{employeeId}/employee-number',
    expect.objectContaining({ body: { employee_number: 7 } }),
  );
});

it('keeps the old number when the server says it is taken', async () => {
  state.refuse = {
    code: 'EMPLOYEE_NUMBER_TAKEN',
    message_en: 'Synthetic taken',
    message_ar: t('ar', 'errors.EMPLOYEE_NUMBER_TAKEN'),
  };
  renderProfile();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'staff.editNumber') }));
  fireEvent.change(screen.getByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '007' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveNumber') }));
  expect((await screen.findByRole('alert')).textContent).toBe('Synthetic taken');
  expect((screen.getByLabelText(t('en', 'staff.employeeNumber')) as HTMLInputElement).value).toBe(
    '007',
  );
  expect(screen.getByRole('cell', { name: '15' })).toBeTruthy();
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('hides edit number from a non-holder', async () => {
  state.canType = false;
  const query = renderProfile();
  await screen.findByRole('cell', { name: '15' });
  await waitFor(() => {
    const entry = query.getQueryCache().find({
      queryKey: ['employee-number-capability'],
      exact: false,
    });
    expect(entry?.state.status).toBe('success');
    expect(entry?.state.data).toEqual({ can_type_number: false });
  });
  expect(screen.queryByRole('button', { name: t('en', 'staff.editNumber') })).toBeNull();
});

it('does not save an invalid employee number', async () => {
  renderProfile();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'staff.editNumber') }));
  fireEvent.change(screen.getByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '12a' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveNumber') }));
  expect((await screen.findByRole('alert')).textContent).toBe(t('en', 'staff.numberInvalid'));
  expect(put).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it.each(['escape', 'close'] as const)('returns focus to edit number after %s', async (method) => {
  renderProfile();
  const opener = await screen.findByRole('button', { name: t('en', 'staff.editNumber') });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('dialog');
  expect(dialog.contains(document.activeElement)).toBe(true);
  if (method === 'escape') fireEvent(dialog, new Event('cancel', { cancelable: true }));
  else fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.closeNumber') }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it('keeps the new number when a later read still has the old one', async () => {
  let numberReads = 0;
  get.mockImplementation((path: string) => {
    if (path === '/v1/businesses/{businessId}/employee-number-capability') {
      return Promise.resolve({ data: { can_type_number: true } });
    }
    if (path === '/v1/businesses/{businessId}/employees/{employeeId}') {
      return Promise.resolve({ data: detail() });
    }
    if (path === '/v1/businesses/{businessId}/employees') {
      return Promise.resolve({ data: { items: [listItem()], next_cursor: null } });
    }
    if (path === '/v1/employee-numbers') {
      numberReads += 1;
      if (numberReads > 1) return new Promise(() => undefined);
      return Promise.resolve({ data: { items: [], next_cursor: null } });
    }
    return Promise.resolve({
      error: { message_en: 'Synthetic missing', message_ar: 'Synthetic missing' },
      response: { status: 404 },
    });
  });
  put.mockImplementation(() => {
    state.number = 7;
    return Promise.resolve({ data: { employee_id: id, employee_number: 7 } });
  });
  renderProfile(<CompanyNumbersProbe />);
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'staff.editNumber') }));
  fireEvent.change(screen.getByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '007' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveNumber') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('cell', { name: '7' })).toBeTruthy();
    expect(numberReads).toBeGreaterThan(1);
  });
});

it('hides edit number when a capability refetch fails and the old success is kept', async () => {
  let reads = 0;
  get.mockImplementation((path: string) => {
    if (path === '/v1/businesses/{businessId}/employee-number-capability') {
      reads += 1;
      if (reads === 1) return Promise.resolve({ data: { can_type_number: true } });
      return Promise.resolve({
        error: {
          code: 'FORBIDDEN',
          message_en: 'Synthetic refusal',
          message_ar: t('ar', 'errors.FORBIDDEN'),
        },
        response: { status: 403 },
      });
    }
    if (path === '/v1/businesses/{businessId}/employees/{employeeId}') {
      return Promise.resolve({ data: detail() });
    }
    if (path === '/v1/businesses/{businessId}/employees') {
      return Promise.resolve({ data: { items: [listItem()], next_cursor: null } });
    }
    return Promise.resolve({
      error: { message_en: 'Synthetic missing', message_ar: 'Synthetic missing' },
      response: { status: 404 },
    });
  });
  const query = renderProfile();
  await screen.findByRole('button', { name: t('en', 'staff.editNumber') });
  await query.invalidateQueries({ queryKey: ['employee-number-capability', id, id] });
  await waitFor(() => {
    const entry = query.getQueryCache().find({
      queryKey: ['employee-number-capability'],
      exact: false,
    });
    expect(entry?.state.status).toBe('error');
    expect(entry?.state.data).toEqual({ can_type_number: true });
  });
  expect(screen.queryByRole('button', { name: t('en', 'staff.editNumber') })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps the refusal dialog open after the capability becomes false', async () => {
  put.mockImplementation(() => {
    state.canType = false;
    return Promise.resolve({
      error: {
        code: 'FORBIDDEN',
        message_en: 'Synthetic refusal',
        message_ar: t('ar', 'errors.FORBIDDEN'),
      },
    });
  });
  renderProfile();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'staff.editNumber') }));
  fireEvent.change(screen.getByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '8' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveNumber') }));
  expect((await screen.findByRole('alert')).textContent).toBe('Synthetic refusal');
  await waitFor(() => {
    expect(
      (screen.getByLabelText(t('en', 'staff.employeeNumber')) as HTMLInputElement).disabled,
    ).toBe(true);
  });
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: t('en', 'staff.editNumber') }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: t('en', 'staff.saveNumber') }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: t('en', 'staff.closeNumber') }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.closeNumber') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: t('en', 'staff.editNumber') })).toBeNull();
  });
});
