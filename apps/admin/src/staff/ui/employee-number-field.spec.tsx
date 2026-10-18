import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CreateEmployeeForm } from './create-employee-form';

window.HTMLElement.prototype.scrollIntoView = () => undefined;
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => undefined;
window.HTMLElement.prototype.releasePointerCapture = () => undefined;

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('../api/use-employee-name-matches', () => ({
  useEmployeeNameMatches: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ matches: [], visible_total: 0, hidden_exists: false }),
  }),
}));

const allowed = '01920000-0000-7000-8000-0000000000a2';
const deniedBranch = '01920000-0000-7000-8000-0000000000b2';
const deniedBusiness = '01920000-0000-7000-8000-0000000000c2';
type CapabilityCall = {
  params: { path: { businessId: string }; query: { primary_branch_id: string } };
};
function branch(id: string, name: string) {
  return { id, name_en: name, name_ar: null, effective_timezone: 'Asia/Kuwait', is_active: true };
}
function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function mount(
  query: QueryClient,
  save: (terms: unknown) => void,
  branches: ReturnType<typeof branch>[],
  serverError: unknown,
  businessId = allowed,
) {
  return (
    <QueryClientProvider client={query}>
      <CreateEmployeeForm
        companyId={allowed}
        businessId={businessId}
        userId={allowed}
        branches={branches}
        pending={false}
        serverError={serverError}
        onSave={save}
      />
    </QueryClientProvider>
  );
}
async function settled(query: QueryClient) {
  await waitFor(() => {
    const entry = query.getQueryCache().find({
      queryKey: ['employee-number-capability'],
      exact: false,
    });
    expect(entry?.state.status).toBe('success');
  });
}
function fillIdentity() {
  fireEvent.change(screen.getByLabelText(t('en', 'staff.nameEn')), {
    target: { value: 'Synthetic employee' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'staff.hireDate')), {
    target: { value: '2026-01-01' },
  });
}
function capabilityCall(businessId: string, branchId: string) {
  return [
    '/v1/businesses/{businessId}/employee-number-capability',
    expect.objectContaining({
      params: expect.objectContaining({
        path: { businessId },
        query: { primary_branch_id: branchId },
      }),
    }),
  ];
}
beforeEach(() => get.mockReset());

it('shows the number field when the holder may type for the selected branch', async () => {
  get.mockResolvedValue({ data: { can_type_number: true } });
  const query = client();
  render(mount(query, vi.fn(), [branch(allowed, 'Allowed branch')], null));
  expect(await screen.findByLabelText(t('en', 'staff.employeeNumber'))).toBeTruthy();
  expect(get).toHaveBeenCalledWith(...capabilityCall(allowed, allowed));
});

it('does not render the field when the business denies typing', async () => {
  get.mockResolvedValue({ data: { can_type_number: false } });
  const query = client();
  render(mount(query, vi.fn(), [branch(allowed, 'Allowed branch')], null, deniedBusiness));
  await settled(query);
  expect(screen.queryByLabelText(t('en', 'staff.employeeNumber'))).toBeNull();
  expect(get).toHaveBeenCalledWith(...capabilityCall(deniedBusiness, allowed));
});

it('does not render the field when the primary branch denies typing', async () => {
  get.mockResolvedValue({ data: { can_type_number: false } });
  const query = client();
  render(mount(query, vi.fn(), [branch(deniedBranch, 'Denied branch')], null));
  await settled(query);
  expect(screen.queryByLabelText(t('en', 'staff.employeeNumber'))).toBeNull();
  expect(get).toHaveBeenCalledWith(...capabilityCall(allowed, deniedBranch));
});

it('does not render the field for a non-holder', async () => {
  get.mockResolvedValue({ data: { can_type_number: false } });
  const query = client();
  render(mount(query, vi.fn(), [branch(allowed, 'Allowed branch')], null));
  await waitFor(() => {
    const entry = query.getQueryCache().find({
      queryKey: ['employee-number-capability'],
      exact: false,
    });
    expect(entry?.state.data).toEqual({ can_type_number: false });
  });
  expect(screen.queryByLabelText(t('en', 'staff.employeeNumber'))).toBeNull();
});

it('re-asks when the primary branch changes and clears a typed number', async () => {
  get.mockImplementation((path: string, init?: CapabilityCall) =>
    Promise.resolve({
      data: {
        can_type_number:
          path === '/v1/businesses/{businessId}/employee-number-capability' &&
          init?.params?.query?.primary_branch_id === allowed,
      },
    }),
  );
  render(
    mount(client(), vi.fn(), [branch(allowed, 'Allowed branch'), branch(deniedBranch, 'Denied branch')], null),
  );
  fireEvent.change(await screen.findByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '007' },
  });
  await chooseBranch('Denied branch');
  await waitFor(() => expect(screen.queryByLabelText(t('en', 'staff.employeeNumber'))).toBeNull());
  expect(get).toHaveBeenCalledWith(...capabilityCall(allowed, deniedBranch));
  await chooseBranch('Allowed branch');
  expect((await screen.findByLabelText(t('en', 'staff.employeeNumber')) as HTMLInputElement).value).toBe('');
});

it('sends 007 as employee number 7', async () => {
  get.mockResolvedValue({ data: { can_type_number: true } });
  const save = vi.fn();
  render(mount(client(), save, [branch(allowed, 'Allowed branch')], null));
  fireEvent.change(await screen.findByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '007' },
  });
  fillIdentity();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.create') }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0]?.[0]).toMatchObject({ employee_number: 7 });
});

it('omits employee_number when the field is left blank', async () => {
  get.mockResolvedValue({ data: { can_type_number: true } });
  const save = vi.fn();
  render(mount(client(), save, [branch(allowed, 'Allowed branch')], null));
  await screen.findByLabelText(t('en', 'staff.employeeNumber'));
  fillIdentity();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.create') }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(Object.hasOwn(save.mock.calls[0]?.[0] as object, 'employee_number')).toBe(false);
});

it('does not send an invalid number', async () => {
  get.mockResolvedValue({ data: { can_type_number: true } });
  const save = vi.fn();
  render(mount(client(), save, [branch(allowed, 'Allowed branch')], null));
  fireEvent.change(await screen.findByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '12a' },
  });
  fillIdentity();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.create') }));
  expect((await screen.findByRole('alert')).textContent).toBe(t('en', 'staff.numberInvalid'));
  expect(save).not.toHaveBeenCalled();
});

it.each([
  ['EMPLOYEE_NUMBER_TAKEN', 'Synthetic taken'],
  ['FORBIDDEN', 'Synthetic refusal'],
] as const)('keeps the typed number when the server returns %s', async (code, messageEn) => {
  get.mockResolvedValue({ data: { can_type_number: true } });
  const query = client();
  const error = { code, message_en: messageEn, message_ar: t('ar', 'errors.FORBIDDEN') };
  const view = render(mount(query, vi.fn(), [branch(allowed, 'Allowed branch')], null));
  fireEvent.change(await screen.findByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '007' },
  });
  view.rerender(mount(query, vi.fn(), [branch(allowed, 'Allowed branch')], error));
  expect((screen.getByLabelText(t('en', 'staff.employeeNumber')) as HTMLInputElement).value).toBe('007');
  expect(screen.getByRole('alert').textContent).toBe(messageEn);
});

async function chooseBranch(name: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: t('en', 'staff.primaryBranch') }), {
    key: 'ArrowDown',
  });
  fireEvent.click(await screen.findByRole('option', { name }));
}
