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
const nameCheck = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('../api/use-employee-name-matches', () => ({
  useEmployeeNameMatches: () => ({ mutateAsync: nameCheck }),
}));

const allowed = '01920000-0000-7000-8000-0000000000a2';
const secondAllowed = '01920000-0000-7000-8000-0000000000d2';
const deniedBranch = '01920000-0000-7000-8000-0000000000b2';
type CapabilityCall = {
  params: { query: { primary_branch_id: string } };
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
) {
  return (
    <QueryClientProvider client={query}>
      <CreateEmployeeForm
        companyId={allowed}
        businessId={allowed}
        userId={allowed}
        branches={branches}
        pending={false}
        onSave={save}
      />
    </QueryClientProvider>
  );
}
function fillIdentity() {
  fireEvent.change(screen.getByLabelText(t('en', 'staff.nameEn')), {
    target: { value: 'Synthetic employee' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'staff.hireDate')), {
    target: { value: '2026-01-01' },
  });
}
function createButton() {
  return screen.getByRole('button', { name: t('en', 'staff.create') }) as HTMLButtonElement;
}
beforeEach(() => {
  get.mockReset();
  nameCheck.mockReset();
  nameCheck.mockResolvedValue({ matches: [], visible_total: 0, hidden_exists: false });
});

it('hides the number field when a capability refetch fails and the old success is kept', async () => {
  let reads = 0;
  get.mockImplementation(() => {
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
  });
  const query = client();
  render(mount(query, vi.fn(), [branch(allowed, 'Allowed branch')]));
  expect(
    await screen.findByRole('textbox', { name: t('en', 'staff.employeeNumber') }),
  ).toBeTruthy();
  await query.invalidateQueries({ queryKey: ['employee-number-capability', allowed, allowed] });
  await waitFor(() => {
    const entry = query.getQueryCache().find({
      queryKey: ['employee-number-capability'],
      exact: false,
    });
    expect(entry?.state.status).toBe('error');
    expect(entry?.state.data).toEqual({ can_type_number: true });
  });
  expect(screen.queryByLabelText(t('en', 'staff.employeeNumber'))).toBeNull();
});

it('holds submit until an uncached allowed branch resolves and then sends 1005', async () => {
  let release: (value: unknown) => void = () => undefined;
  get.mockImplementation((_path: string, init?: CapabilityCall) => {
    if (init?.params.query.primary_branch_id === secondAllowed) {
      return new Promise((resolve) => {
        release = resolve;
      });
    }
    return Promise.resolve({ data: { can_type_number: true } });
  });
  const save = vi.fn();
  render(
    mount(client(), save, [
      branch(allowed, 'Allowed branch'),
      branch(secondAllowed, 'Second allowed'),
    ]),
  );
  fireEvent.change(await screen.findByRole('textbox', { name: t('en', 'staff.employeeNumber') }), {
    target: { value: '1005' },
  });
  await chooseBranch('Second allowed');
  await waitFor(() => expect(createButton().disabled).toBe(true));
  const kept = document.querySelector('#employee-number') as HTMLInputElement;
  expect(kept.value).toBe('1005');
  expect(kept.disabled).toBe(false);
  expect(kept.closest('[hidden]')).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: t('en', 'staff.employeeNumber') })).toBeNull();
  fillIdentity();
  fireEvent.click(createButton());
  expect(save).not.toHaveBeenCalled();
  release({ data: { can_type_number: true } });
  await waitFor(() => expect(createButton().disabled).toBe(false));
  expect((screen.getByLabelText(t('en', 'staff.employeeNumber')) as HTMLInputElement).value).toBe(
    '1005',
  );
  fireEvent.click(createButton());
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0]?.[0]).toMatchObject({ employee_number: 1005 });
});

it('submits without a number when a hidden invalid draft is cleared', async () => {
  get.mockImplementation((_path: string, init?: CapabilityCall) =>
    Promise.resolve({
      data: { can_type_number: init?.params.query.primary_branch_id === allowed },
    }),
  );
  const save = vi.fn();
  render(
    mount(client(), save, [
      branch(allowed, 'Allowed branch'),
      branch(deniedBranch, 'Denied branch'),
    ]),
  );
  fireEvent.change(await screen.findByRole('textbox', { name: t('en', 'staff.employeeNumber') }), {
    target: { value: 'abc' },
  });
  await chooseBranch('Denied branch');
  await waitFor(() => expect(screen.queryByLabelText(t('en', 'staff.employeeNumber'))).toBeNull());
  await waitFor(() => expect(createButton().disabled).toBe(false));
  fillIdentity();
  fireEvent.click(createButton());
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(Object.hasOwn(save.mock.calls[0]?.[0] as object, 'employee_number')).toBe(false);
});

it('omits employee_number on confirm after the capability refetch blocks the field', async () => {
  let reads = 0;
  get.mockImplementation(() => {
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
  });
  nameCheck.mockResolvedValue({ matches: [], visible_total: 0, hidden_exists: true });
  const save = vi.fn();
  const query = client();
  render(mount(query, save, [branch(allowed, 'Allowed branch')]));
  fireEvent.change(await screen.findByRole('textbox', { name: t('en', 'staff.employeeNumber') }), {
    target: { value: '1005' },
  });
  fillIdentity();
  fireEvent.click(createButton());
  await screen.findByText(t('en', 'staff.duplicateNameLead'));
  await query.invalidateQueries({ queryKey: ['employee-number-capability', allowed, allowed] });
  await waitFor(() => expect(screen.queryByLabelText(t('en', 'staff.employeeNumber'))).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.duplicateNameSaveAnyway') }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(Object.hasOwn(save.mock.calls[0]?.[0] as object, 'employee_number')).toBe(false);
});

async function chooseBranch(name: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: t('en', 'staff.primaryBranch') }), {
    key: 'ArrowDown',
  });
  fireEvent.click(await screen.findByRole('option', { name }));
}
