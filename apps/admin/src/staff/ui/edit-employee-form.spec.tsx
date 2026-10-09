import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EditEmployeeForm } from './edit-employee-form';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en', check: vi.fn() }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-employee-name-matches', () => ({
  useEmployeeNameMatches: () => ({ mutateAsync: state.check }),
}));
beforeEach(() => {
  state.locale = 'en';
  state.check.mockReset().mockResolvedValue({ matches: [], visible_total: 0, hidden_count: 0 });
});
const branch = {
  id: '01920000-0000-7000-8000-0000000000a2',
  name_en: 'Synthetic primary',
  name_ar: t('ar', 'staff.primaryBranch'),
  effective_timezone: 'Asia/Kuwait',
  is_active: true,
};
const sibling = {
  ...branch,
  id: '01920000-0000-7000-8000-0000000000a3',
  name_en: 'Synthetic sibling',
  name_ar: t('ar', 'staff.branches'),
};
const record = {
  id: '01920000-0000-7000-8000-0000000000a4',
  business_id: branch.id,
  primary_branch_id: branch.id,
  name_en: 'Synthetic employee',
  name_ar: null,
  role_code: 'staff' as const,
  hire_date: '2026-01-01',
  contract_end: null,
  user_id: sibling.id,
  created_at: '2026-10-03T00:00:00Z',
  revision: 7,
  branch_ids: [branch.id],
};
it.each(['ar', 'en'] as const)(
  'reuses create fields, submits revision/attachments/date and unlinks in %s',
  async (locale) => {
    state.locale = locale;
    const save = vi.fn();
    render(
      <EditEmployeeForm
        companyId={branch.id}
        businessId={record.business_id}
        record={record}
        branches={[branch, sibling]}
        pending={false}
        onSave={save}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'staff.save') }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(t(locale, 'staff.effectiveDate')), {
      target: { value: '2026-10-04' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'staff.nameEn')), {
      target: { value: 'Changed employee' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'staff.userId')), { target: { value: '' } });
    fireEvent.click(
      screen.getByRole('checkbox', { name: locale === 'ar' ? sibling.name_ar : sibling.name_en }),
    );
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'staff.save') }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      name_en: 'Changed employee',
      user_id: null,
      expected_revision: 7,
      branch_ids: [branch.id, sibling.id],
      branch_effective_date: '2026-10-04',
      primary_branch_id: branch.id,
    });
  },
);
it('locks shared fields, branch choices and submission during save', () => {
  render(
    <EditEmployeeForm
      companyId={branch.id}
      businessId={record.business_id}
      record={record}
      branches={[branch]}
      pending={true}
      onSave={vi.fn()}
    />,
  );
  expect(screen.getByRole('button').closest('fieldset')?.disabled).toBe(true);
  expect(
    screen.getByRole('checkbox').closest('fieldset')?.parentElement?.closest('fieldset')?.disabled,
  ).toBe(true);
});

const props = {
  companyId: branch.id,
  businessId: record.business_id,
  record,
  branches: [branch, sibling],
  pending: false,
};
it('DN-07 confirms the exact PATCH terms including revision and branch history fields', async () => {
  state.check.mockResolvedValue({ matches: [], visible_total: 0, hidden_count: 1 });
  const save = vi.fn();
  render(<EditEmployeeForm {...props} onSave={save} />);
  fireEvent.change(screen.getByLabelText(t('en', 'staff.nameEn')), {
    target: { value: 'Renamed employee' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'staff.effectiveDate')), {
    target: { value: '2026-10-04' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: sibling.name_en }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.save') }));
  await screen.findByText(t('en', 'staff.duplicateNameLead'));
  expect(state.check).toHaveBeenCalledExactlyOnceWith({
    name_en: 'Renamed employee',
    name_ar: null,
    exclude_employee_id: record.id,
  });
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.duplicateNameSaveAnyway') }));
  expect(save).toHaveBeenCalledExactlyOnceWith({
    name_en: 'Renamed employee',
    name_ar: null,
    role_code: 'staff',
    primary_branch_id: branch.id,
    hire_date: record.hire_date,
    contract_end: null,
    user_id: sibling.id,
    expected_revision: 7,
    branch_ids: [branch.id, sibling.id],
    branch_effective_date: '2026-10-04',
  });
  expect(state.check).toHaveBeenCalledOnce();
});

it('DN-08 skips the check for a non-name change or merely outer whitespace', async () => {
  const save = vi.fn();
  render(<EditEmployeeForm {...props} onSave={save} />);
  fireEvent.change(screen.getByLabelText(t('en', 'staff.nameEn')), {
    target: { value: ` ${record.name_en} ` },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'staff.hireDate')), {
    target: { value: '2026-01-02' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'staff.effectiveDate')), {
    target: { value: '2026-10-04' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.save') }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(state.check).not.toHaveBeenCalled();
});

it('checks an Arabic-only change and fails open on edit too', async () => {
  state.check.mockRejectedValue(new Error('Synthetic failure'));
  const save = vi.fn();
  render(<EditEmployeeForm {...props} onSave={save} />);
  fireEvent.change(screen.getByLabelText(t('en', 'staff.nameAr')), {
    target: { value: t('ar', 'roles.staff') },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'staff.effectiveDate')), {
    target: { value: '2026-10-04' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.save') }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(state.check).toHaveBeenCalledWith({
    name_en: record.name_en,
    name_ar: t('ar', 'roles.staff'),
    exclude_employee_id: record.id,
  });
  expect(screen.queryByRole('alert')).toBeNull();
});
