import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { EmployeeCardSection } from './employee-card-section';

const suffix = vi.hoisted(() => ({ value: '' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('../api/use-employee-cards', () => ({
  useEmployeeCards: () => ({
    view: {
      isFetchedAfterMount: true,
      isError: false,
      data: {
        can_manage: true,
        active: { id: 'synthetic-card', card_code_suffix: suffix.value },
      },
    },
    issue: { isPending: false, isError: false, isSuccess: false, mutate: vi.fn() },
    revoke: { isPending: false, isError: false, mutate: vi.fn() },
  }),
}));

it.each(['', 'EFGH'])(
  'displays only the permitted suffix %s and masks the issue field',
  (value) => {
    suffix.value = value;
    render(
      <EmployeeCardSection
        companyId="synthetic-company"
        businessId="synthetic-business"
        userId="synthetic-user"
        employeeId="synthetic-employee"
      />,
    );
    const label = t('en', 'employeeCard.active');
    expect(screen.getByText(value ? `${label}: ••••${value}` : label)).not.toBeNull();
    const input = screen.getByLabelText(t('en', 'employeeCard.issue')) as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.classList.contains('card-code-mask')).toBe(true);
    expect(input.autocomplete).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('autocapitalize')).toBe('off');
  },
);
