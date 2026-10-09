import { t } from '@pospay/i18n';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CreateEmployeeForm } from './create-employee-form';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en', check: vi.fn() }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-employee-name-matches', () => ({
  useEmployeeNameMatches: () => ({ mutateAsync: state.check }),
}));
const empty = { matches: [], visible_total: 0, hidden_count: 0 };
const duplicate = { matches: [], visible_total: 0, hidden_count: 1 };
beforeEach(() => {
  state.locale = 'en';
  state.check.mockReset().mockResolvedValue(empty);
});
const branch = {
  id: '01920000-0000-7000-8000-0000000000a2',
  name_en: 'Synthetic branch',
  name_ar: t('ar', 'admin.branchLabel'),
  effective_timezone: 'Asia/Kuwait',
  is_active: true,
};
it.each(['ar', 'en'] as const)(
  'validates and submits the contract with bilingual labels in %s',
  async (locale) => {
    state.locale = locale;
    const save = vi.fn();
    render(
      <CreateEmployeeForm
        companyId={branch.id}
        businessId={branch.id}
        branches={[branch]}
        pending={false}
        onSave={save}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'staff.create') }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(t(locale, 'staff.nameEn')), {
      target: { value: '  Synthetic employee  ' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'staff.hireDate')), {
      target: { value: '2026-01-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'staff.create') }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(state.check).toHaveBeenCalledWith({ name_en: 'Synthetic employee', name_ar: null });
    expect(save.mock.calls[0]?.[0]).toEqual({
      primary_branch_id: branch.id,
      name_en: 'Synthetic employee',
      name_ar: null,
      role_code: 'staff',
      hire_date: '2026-01-01',
      contract_end: null,
      user_id: null,
    });
    expect(screen.getByLabelText(t(locale, 'staff.userId'))).toBeTruthy();
  },
);
it('disables submission during the pending request', () => {
  render(
    <CreateEmployeeForm
      companyId={branch.id}
      businessId={branch.id}
      branches={[branch]}
      pending={true}
      onSave={vi.fn()}
    />,
  );
  expect(screen.getByRole('button').closest('fieldset')?.disabled).toBe(true);
});

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(t('en', 'staff.nameEn')), {
    target: { value: 'Synthetic duplicate' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'staff.nameAr')), {
    target: { value: t('ar', 'roles.staff') },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'staff.hireDate')), {
    target: { value: '2026-01-01' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'staff.contractEnd')), {
    target: { value: '2027-01-01' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.create') }));
}
const props = { companyId: branch.id, businessId: branch.id, branches: [branch], pending: false };

it('DN-02 waits for confirmation, then saves the original terms exactly once without a second check', async () => {
  state.check.mockResolvedValue(duplicate);
  const save = vi.fn();
  render(<CreateEmployeeForm {...props} onSave={save} />);
  fillAndSubmit();
  await screen.findByText(t('en', 'staff.duplicateNameLead'));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.duplicateNameSaveAnyway') }));
  expect(save).toHaveBeenCalledExactlyOnceWith({
    name_en: 'Synthetic duplicate',
    name_ar: t('ar', 'roles.staff'),
    primary_branch_id: branch.id,
    role_code: 'staff',
    hire_date: '2026-01-01',
    contract_end: '2027-01-01',
    user_id: null,
  });
  expect(state.check).toHaveBeenCalledOnce();
  expect(screen.queryByText(t('en', 'staff.duplicateNameLead'))).toBeNull();
});

it('DN-03 edit name preserves every form value and focuses the Arabic name', async () => {
  state.check.mockResolvedValue(duplicate);
  const save = vi.fn();
  render(<CreateEmployeeForm {...props} onSave={save} />);
  fillAndSubmit();
  await screen.findByText(t('en', 'staff.duplicateNameLead'));
  const form = screen.getByLabelText(t('en', 'staff.nameEn')).closest('form') as HTMLFormElement;
  const before = Array.from(form.querySelectorAll('input, select')).map(
    (field) => (field as HTMLInputElement).value,
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.duplicateNameEdit') }));
  await waitFor(() => expect(document.activeElement?.id).toBe('employee-name-ar'));
  expect(
    Array.from(form.querySelectorAll('input, select')).map(
      (field) => (field as HTMLInputElement).value,
    ),
  ).toEqual(before);
  expect(save).not.toHaveBeenCalled();
});

it('DN-12 a failed name check saves directly without showing a warning', async () => {
  state.check.mockRejectedValue(new Error('Synthetic offline'));
  const save = vi.fn();
  render(<CreateEmployeeForm {...props} onSave={save} />);
  fillAndSubmit();
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['companyId', 'businessId'] as const)('clears a warning when %s changes', async (field) => {
  state.check.mockResolvedValue(duplicate);
  const save = vi.fn();
  const view = render(<CreateEmployeeForm {...props} onSave={save} />);
  fillAndSubmit();
  await screen.findByText(t('en', 'staff.duplicateNameLead'));
  view.rerender(
    <CreateEmployeeForm
      {...props}
      {...{ [field]: '01920000-0000-7000-8000-0000000000b2' }}
      onSave={save}
    />,
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(save).not.toHaveBeenCalled();
});

it.each([empty, duplicate])(
  'discards an in-flight check after switching workspace',
  async (result) => {
    let resolve!: (value: typeof empty) => void;
    state.check.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const save = vi.fn();
    const view = render(<CreateEmployeeForm {...props} onSave={save} />);
    fillAndSubmit();
    await waitFor(() => expect(state.check).toHaveBeenCalledOnce());
    expect(screen.getByRole('button').closest('fieldset')?.disabled).toBe(true);
    view.rerender(
      <CreateEmployeeForm
        {...props}
        businessId="01920000-0000-7000-8000-0000000000b2"
        onSave={save}
      />,
    );
    await act(async () => {
      resolve(result);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(save).not.toHaveBeenCalled();
  },
);
