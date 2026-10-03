import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CreateEmployeeForm } from './create-employee-form';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
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
    render(<CreateEmployeeForm branches={[branch]} pending={false} onSave={save} />);
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
  render(<CreateEmployeeForm branches={[branch]} pending={true} onSave={vi.fn()} />);
  expect(screen.getByRole('button').closest('fieldset')?.disabled).toBe(true);
});
