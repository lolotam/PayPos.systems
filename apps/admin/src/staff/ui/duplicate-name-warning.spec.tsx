import { t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DuplicateNameWarning } from './duplicate-name-warning';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const id = '01920000-0000-7000-8000-0000000000ab';
const branch = {
  id,
  name_en: 'Synthetic branch',
  name_ar: t('ar', 'staff.primaryBranch'),
  effective_timezone: 'Asia/Kuwait',
  is_active: true,
};
const match = {
  id,
  name_en: 'Synthetic name',
  name_ar: t('ar', 'staff.name'),
  primary_branch_id: id,
  role_code: 'staff' as const,
};

it.each(['ar', 'en'] as const)(
  'shows visible details, one hidden line, more count and actions in %s',
  (locale) => {
    state.locale = locale;
    const dismiss = vi.fn(),
      confirm = vi.fn();
    render(
      <DuplicateNameWarning
        matches={{ matches: [match], visible_total: 12, hidden_exists: true }}
        branches={[branch]}
        onEdit={dismiss}
        onConfirm={confirm}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    for (const key of [
      'duplicateNameTitle',
      'duplicateNameLead',
      'duplicateNameHidden',
      'duplicateNameMore',
    ] as const)
      expect(alert.textContent).toContain(t(locale, `staff.${key}`));
    expect(alert.textContent).toContain('11');
    expect(alert.textContent).toContain(match.name_en);
    expect(alert.textContent).toContain(match.name_ar);
    expect(alert.textContent).toContain(locale === 'ar' ? branch.name_ar : branch.name_en);
    expect(alert.textContent).toContain(t(locale, 'roles.staff'));
    expect(screen.getAllByText(t(locale, 'staff.duplicateNameHidden'))).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'staff.duplicateNameEdit') }));
    expect(dismiss).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole('button', { name: t(locale, 'staff.duplicateNameSaveAnyway') }),
    );
    expect(confirm).toHaveBeenCalledOnce();
  },
);

it('renders hidden-only matches without employee details or identifiers', () => {
  state.locale = 'en';
  render(
    <DuplicateNameWarning
      matches={{ matches: [], visible_total: 0, hidden_exists: true }}
      branches={[branch]}
      onEdit={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.queryByRole('list')).toBeNull();
  expect(screen.getByRole('alert').textContent).not.toContain(id);
  expect(screen.queryByText(t('en', 'staff.duplicateNameMore'))).toBeNull();
});
